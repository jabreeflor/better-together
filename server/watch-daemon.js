// Watch daemon: subscribes to host's SSE /events and writes a rolling
// transcript snapshot to BT_CONTEXT_FILE. The bt-relay reads that file
// during UserPromptSubmit and injects it as additionalContext.

const fs = require('fs');
const http = require('http');
const https = require('https');

const HOST_URL = process.env.BT_HOST_URL;
const CTX_FILE = process.env.BT_CONTEXT_FILE;
const MAX_CHARS = 8000; // leave headroom under the 10K additionalContext cap

if (!HOST_URL || !CTX_FILE) {
  console.error('BT_HOST_URL and BT_CONTEXT_FILE required');
  process.exit(2);
}

const u = new URL(HOST_URL);
const lib = u.protocol === 'https:' ? https : http;

let transcript = [];
let comments = [];
let presence = [];

function renderContext() {
  const lines = [];
  lines.push(`# Better Together — host session context`);
  lines.push(`# Source: ${HOST_URL}`);
  lines.push(`# Snapshot at: ${new Date().toISOString()}`);
  lines.push(``);
  if (presence.length) {
    lines.push(`## People in the room`);
    for (const p of presence) {
      lines.push(`- ${p.display_name} (${p.mode})`);
    }
    lines.push(``);
  }
  lines.push(`## Recent turns`);
  // Render newest-first then take the most recent that fit under MAX_CHARS
  const rendered = [];
  for (const t of transcript) {
    rendered.push(formatTurn(t));
  }
  // Walk from the end, build until we'd exceed MAX_CHARS
  const acc = [];
  let used = lines.join('\n').length;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const next = rendered[i] + '\n\n';
    if (used + next.length > MAX_CHARS) break;
    acc.unshift(next);
    used += next.length;
  }
  if (rendered.length && acc.length < rendered.length) {
    lines.push(`(showing the most recent ${acc.length} of ${rendered.length} turns)`);
    lines.push(``);
  }
  lines.push(...acc.map(s => s.trimEnd()));
  if (comments.length) {
    lines.push(``);
    lines.push(`## Comments left by watchers (advisory; not visible to the host's Claude unless they read them)`);
    for (const c of comments.slice(-15)) {
      lines.push(`- ${c.author} → ${c.anchor || '(unanchored)'}: ${truncate(c.text, 200)}`);
    }
  }
  return lines.join('\n');
}

function formatTurn(t) {
  const head = `### [${t.id}] ${t.kind}`;
  const p = t.payload || {};
  let body = '';
  switch (t.kind) {
    case 'user_prompt':
      body = truncate(p.prompt || '', 1000);
      break;
    case 'pre_tool_use':
    case 'post_tool_use':
      body = `tool: ${p.tool_name || '?'}\n${codeBlock(JSON.stringify(p.tool_input || {}, null, 2), 800)}`;
      if (p.tool_response) {
        const r = typeof p.tool_response === 'string' ? p.tool_response : JSON.stringify(p.tool_response);
        body += `\nresult: ${truncate(r, 400)}`;
      }
      break;
    case 'stop':
      body = '(assistant turn complete)';
      break;
    case 'permission_prompt':
      body = `host is being asked to approve a tool call`;
      break;
    default:
      body = truncate(JSON.stringify(p), 400);
  }
  return `${head}\n${body}`;
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function codeBlock(s, n) {
  return '```\n' + truncate(s, n) + '\n```';
}

function flush() {
  try {
    fs.writeFileSync(CTX_FILE, renderContext());
  } catch (e) { /* ignore */ }
}

// Pull initial snapshot
function fetchSnapshot() {
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: '/snapshot.json',
      method: 'GET',
      headers: { 'accept': 'application/json' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let sseRequest = null;

function connectStream() {
  const req = lib.request({
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: '/events',
    method: 'GET',
    headers: { 'accept': 'text/event-stream' },
  }, res => {
    if (res.statusCode !== 200) {
      res.resume();
      reconnect();
      return;
    }
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleEventBlock(block);
      }
    });
    res.on('end', reconnect);
    res.on('error', reconnect);
  });
  req.on('error', reconnect);
  req.end();
  sseRequest = req;
}

let reconnectTimer = null;
function reconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectStream();
  }, 2000);
}

function handleEventBlock(block) {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;
  try {
    const payload = JSON.parse(data);
    if (event === 'snapshot') {
      transcript = payload.transcript || [];
      comments = payload.comments || [];
      presence = payload.presence || [];
    } else if (event === 'transcript') {
      transcript.push(payload);
      if (transcript.length > 500) transcript.shift();
    } else if (event === 'comment') {
      comments.push(payload);
    } else if (event === 'presence') {
      presence = payload;
    } else if (event === 'room_closed') {
      flush();
      process.exit(0);
    }
    flush();
  } catch (e) { /* ignore */ }
}

// Main
(async () => {
  try {
    const snap = await fetchSnapshot();
    transcript = snap.transcript || [];
    comments = snap.comments || [];
    presence = snap.presence || [];
    flush();
  } catch (e) {
    fs.writeFileSync(CTX_FILE, `# Better Together\n# Could not reach ${HOST_URL} for initial snapshot.\n# Will keep retrying.\n`);
  }
  connectStream();
})();

process.on('SIGTERM', () => { try { sseRequest && sseRequest.destroy(); } catch (e) {} process.exit(0); });
process.on('SIGINT', () => { try { sseRequest && sseRequest.destroy(); } catch (e) {} process.exit(0); });
