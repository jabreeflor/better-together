// transcript-tailer — long-lived child of `bt host`. Reads the active
// Claude Code session's transcript JSONL from disk and POSTs each turn
// to the host server's loopback /events endpoint. Replaces the per-event
// hook-based relay so the room captures everything in the session,
// including turns that happened before `bt host` started, and works even
// when the plugin's hooks weren't registered at session boot.
//
// Required env:
//   BT_PORT          — port of the local host server
//   BT_PROJECT_DIR   — path to ~/.claude/projects/<dasherized-cwd>/
//   CLAUDE_PLUGIN_DATA (optional) — plugin data dir for state lookup fallback

const fs = require('fs');
const path = require('path');
const http = require('http');
const state = require(path.join(__dirname, 'state.js'));

const POLL_INTERVAL_MS = 500;

let PORT = parseInt(process.env.BT_PORT || '0', 10);
const PROJECT_DIR = process.env.BT_PROJECT_DIR;

if (!PORT) {
  try { PORT = (state.read().host || {}).port || 0; } catch (e) { /* fall through */ }
}
if (!PORT || !PROJECT_DIR) {
  console.error(JSON.stringify({ event: 'fatal', reason: 'BT_PORT and BT_PROJECT_DIR required', port: PORT, project_dir: PROJECT_DIR }));
  process.exit(2);
}

// ---------- locate active transcript ----------

function pickActiveJsonl(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return null; }
  let best = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch (e) { continue; }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtime) best = { path: full, mtime: st.mtimeMs };
  }
  return best ? best.path : null;
}

let TRANSCRIPT_PATH = pickActiveJsonl(PROJECT_DIR);
if (!TRANSCRIPT_PATH) {
  console.error(JSON.stringify({ event: 'fatal', reason: 'no jsonl found', project_dir: PROJECT_DIR }));
  process.exit(2);
}
console.log(JSON.stringify({ event: 'tailing', transcript: TRANSCRIPT_PATH, port: PORT, started_at: new Date().toISOString() }));

// ---------- relay ----------

function relay(kind, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ kind, payload });
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/events',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 2000,
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(); });
    req.write(body);
    req.end();
  });
}

// ---------- JSONL → events ----------

const toolUseMeta = new Map(); // tool_use_id -> { tool_name, tool_input }
const seenUuids = new Set();   // line uuid -> processed (defensive against double-reads)

const queue = [];
let draining = false;

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const { kind, payload } = queue.shift();
    try { await relay(kind, payload); } catch (e) { /* fire-and-forget */ }
  }
  draining = false;
}

function enqueue(kind, payload) {
  queue.push({ kind, payload });
  drainQueue();
}

function looksLikeUserNoise(s) {
  // Caveat blocks, command-name wrappers, system-reminder fragments, etc.
  // Real user prompts are plain text starting with a normal character.
  if (!s) return true;
  const trimmed = s.trimStart();
  if (trimmed.startsWith('<')) return true;
  if (trimmed.startsWith('Caveat')) return true;
  return false;
}

function processEntry(entry) {
  if (!entry || typeof entry !== 'object') return;
  if (entry.uuid && seenUuids.has(entry.uuid)) return;
  if (entry.uuid) seenUuids.add(entry.uuid);

  const t = entry.type;
  if (t !== 'user' && t !== 'assistant') return;
  if (entry.isMeta) return;
  if (entry.isSidechain) return;

  const msg = entry.message || {};
  const content = msg.content;

  if (t === 'user') {
    if (typeof content === 'string') {
      if (looksLikeUserNoise(content)) return;
      enqueue('user_prompt', {
        prompt: content,
        session_id: entry.sessionId,
        source: 'transcript',
        uuid: entry.uuid,
      });
      return;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_result') {
          const meta = toolUseMeta.get(block.tool_use_id) || {};
          let response = block.content;
          if (typeof response !== 'string') {
            try { response = JSON.stringify(response); } catch (e) { response = String(response); }
          }
          enqueue('post_tool_use', {
            tool_name: meta.tool_name,
            tool_input: meta.tool_input,
            tool_response: response,
            tool_use_id: block.tool_use_id,
            source: 'transcript',
            uuid: entry.uuid,
          });
        }
      }
    }
    return;
  }

  if (t === 'assistant') {
    if (typeof content === 'string') {
      enqueue('stop', {
        assistant_text: content,
        source: 'transcript',
        uuid: entry.uuid,
      });
      return;
    }
    if (!Array.isArray(content)) return;
    let text = '';
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolUseMeta.set(block.id, { tool_name: block.name, tool_input: block.input });
        enqueue('pre_tool_use', {
          tool_name: block.name,
          tool_input: block.input,
          tool_use_id: block.id,
          source: 'transcript',
          uuid: entry.uuid,
        });
      }
    }
    if (text) {
      enqueue('stop', {
        assistant_text: text,
        source: 'transcript',
        uuid: entry.uuid,
      });
    }
  }
}

function handleLine(line) {
  if (!line.trim()) return;
  let entry;
  try { entry = JSON.parse(line); } catch (e) { return; }
  try { processEntry(entry); } catch (e) {
    console.error(JSON.stringify({ event: 'process_err', err: e && (e.stack || e.message) }));
  }
}

// ---------- tail ----------

let offset = 0;
let pending = '';
let reading = false;

function readNew() {
  if (reading) return;
  reading = true;
  try {
    let st;
    try { st = fs.statSync(TRANSCRIPT_PATH); } catch (e) {
      // File may have been replaced; try to relocate
      const next = pickActiveJsonl(PROJECT_DIR);
      if (next && next !== TRANSCRIPT_PATH) {
        console.log(JSON.stringify({ event: 'rotate', from: TRANSCRIPT_PATH, to: next }));
        TRANSCRIPT_PATH = next;
        offset = 0; pending = '';
      }
      return;
    }
    if (st.size < offset) { offset = 0; pending = ''; }
    if (st.size === offset) return;
    const fd = fs.openSync(TRANSCRIPT_PATH, 'r');
    try {
      const len = st.size - offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      offset = st.size;
      pending += buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    let i;
    while ((i = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      handleLine(line);
    }
  } finally {
    reading = false;
  }
}

readNew(); // initial backfill

fs.watchFile(TRANSCRIPT_PATH, { interval: POLL_INTERVAL_MS }, readNew);

// Also poll the project dir periodically in case the user ran /resume into a
// different jsonl mid-host.
const ROTATE_INTERVAL_MS = 5000;
setInterval(() => {
  const next = pickActiveJsonl(PROJECT_DIR);
  if (next && next !== TRANSCRIPT_PATH) {
    console.log(JSON.stringify({ event: 'rotate', from: TRANSCRIPT_PATH, to: next }));
    try { fs.unwatchFile(TRANSCRIPT_PATH); } catch (e) {}
    TRANSCRIPT_PATH = next;
    offset = 0; pending = '';
    fs.watchFile(TRANSCRIPT_PATH, { interval: POLL_INTERVAL_MS }, readNew);
    readNew();
  }
}, ROTATE_INTERVAL_MS);

function shutdown() {
  try { fs.unwatchFile(TRANSCRIPT_PATH); } catch (e) {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
