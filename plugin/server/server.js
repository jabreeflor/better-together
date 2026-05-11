const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA
  || path.join(os.homedir(), '.claude/plugins/data/better-together');
const HOST_NAME_FILE = path.join(DATA_DIR, 'host-name.txt');

function readHostName() {
  try { return fs.readFileSync(HOST_NAME_FILE, 'utf8').trim().slice(0, 64); }
  catch (e) { return ''; }
}
function writeHostName(name) {
  if (!name) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HOST_NAME_FILE, String(name).slice(0, 64));
  } catch (e) { /* best-effort */ }
}

const PORT = parseInt(process.env.BT_PORT || '0', 10);
const HOST = '127.0.0.1';
const STARTED_AT = new Date().toISOString();

const transcript = [];
const comments = [];
const presence = new Map();
const sseClients = new Set();
let nextEventId = 0;
let nextCommentId = 0;

function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    sseClients.delete(res);
  }
}

function broadcast(event, data) {
  for (const res of sseClients) sseSend(res, event, data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function isLoopback(req) {
  const a = req.socket.remoteAddress;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

// True only when the request came directly to the local server, not through
// a tunnel. cloudflared forwards from 127.0.0.1 too, so we also require the
// Host header to point at 127.0.0.1/localhost and disallow proxy headers.
function isHostRequest(req) {
  if (!isLoopback(req)) return false;
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') return false;
  if (req.headers['cf-connecting-ip']) return false;
  if (req.headers['x-forwarded-for']) return false;
  if (req.headers['x-forwarded-host']) return false;
  return true;
}

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string';
  res.writeHead(status, {
    'content-type': isString && !headers['content-type'] ? 'text/plain' : 'application/json',
    ...headers,
  });
  res.end(isString ? body : JSON.stringify(body));
}

function snapshot() {
  return {
    transcript,
    comments,
    presence: Array.from(presence.values()),
    started_at: STARTED_AT,
    now: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (e) { return send(res, 400, { error: 'bad url' }); }

  // Health
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, started_at: STARTED_AT });
  }

  // Identity — tells the lobby whether it should claim host privileges,
  // and (for the host) returns a remembered display name so they don't have
  // to retype it across rooms with different cloudflared subdomains. For a
  // first-time host with no remembered name we fall back to the OS username
  // so the lobby can skip the join modal entirely — the host is already
  // authenticated by being on loopback.
  if (req.method === 'GET' && url.pathname === '/me') {
    const host = isHostRequest(req);
    let defaultName = '';
    if (host) {
      defaultName = readHostName();
      if (!defaultName) {
        try { defaultName = (os.userInfo().username || '').slice(0, 32); } catch (e) {}
      }
    }
    return send(res, 200, {
      is_host: host,
      default_name: defaultName,
    });
  }

  // Lobby UI
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/ui')) {
    const lobby = path.join(__dirname, 'lobby.html');
    if (fs.existsSync(lobby)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      fs.createReadStream(lobby).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Better Together</title>
<style>body{font-family:system-ui;max-width:680px;margin:4rem auto;padding:1rem;color:#222}code{background:#f4f4f4;padding:.1rem .3rem;border-radius:3px}</style>
<h1>Better Together — room is live</h1>
<p>The lobby UI hasn't been built yet for this version of the plugin. The server is otherwise functional.</p>
<p>Inspect raw state at <a href="/snapshot.json">/snapshot.json</a> · stream events from <a href="/events">/events</a></p>
<p><strong>Started:</strong> ${STARTED_AT}</p>`);
    return;
  }

  // Snapshot
  if (req.method === 'GET' && url.pathname === '/snapshot.json') {
    return send(res, 200, snapshot());
  }

  // SSE stream
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
      // Identity encoding is critical: Cloudflare quick-tunnel edges gzip
      // streaming responses by default, which compresses our flush-padding
      // (4KB of spaces) down to ~50 bytes and re-introduces buffering.
      'content-encoding': 'identity',
    });
    // Pad with non-compressible random-ish bytes so the response can't be
    // squashed below Cloudflare's edge buffer threshold.
    let pad = ': ';
    for (let i = 0; i < 256; i++) pad += Math.random().toString(36).slice(2, 18);
    res.write(pad + '\n\n');
    res.write(': connected\n\n');
    sseClients.add(res);
    sseSend(res, 'snapshot', snapshot());
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Ingest from bt-relay (loopback only)
  if (req.method === 'POST' && url.pathname === '/events') {
    if (!isHostRequest(req)) return send(res, 403, { error: 'host only' });
    try {
      const body = await readBody(req);
      const evt = {
        id: 't' + (++nextEventId),
        ts: new Date().toISOString(),
        kind: body.kind || 'unknown',
        payload: body.payload || {},
      };
      transcript.push(evt);
      // Cap transcript at 500 events to keep memory bounded
      if (transcript.length > 500) transcript.shift();
      broadcast('transcript', evt);
      return send(res, 200, { id: evt.id });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // Comments
  if (req.method === 'POST' && url.pathname === '/comments') {
    try {
      const body = await readBody(req);
      if (!body.text || !body.author) return send(res, 400, { error: 'text and author required' });
      let mode = body.author_mode || 'browser';
      if (mode === 'host' && !isHostRequest(req)) mode = 'browser';
      const c = {
        id: 'c' + (++nextCommentId),
        ts: new Date().toISOString(),
        author: String(body.author).slice(0, 64),
        author_mode: mode,
        anchor: body.anchor || (transcript.length ? transcript[transcript.length - 1].id : null),
        text: String(body.text).slice(0, 2000),
      };
      comments.push(c);
      broadcast('comment', c);
      return send(res, 200, c);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/comments') {
    return send(res, 200, comments);
  }

  // Presence
  if (req.method === 'POST' && url.pathname === '/presence') {
    try {
      const body = await readBody(req);
      const id = String(body.client_id || '').slice(0, 64);
      if (!id) return send(res, 400, { error: 'client_id required' });
      const existing = presence.get(id);
      let mode = body.mode || 'browser';
      if (mode === 'host' && !isHostRequest(req)) mode = 'browser';
      const display_name = String(body.display_name || 'anonymous').slice(0, 32);
      if (mode === 'host' && display_name && display_name !== 'anonymous') {
        writeHostName(display_name);
      }
      presence.set(id, {
        client_id: id,
        display_name,
        mode,
        last_seen: new Date().toISOString(),
        joined_at: existing ? existing.joined_at : new Date().toISOString(),
      });
      if (!existing) broadcast('presence', Array.from(presence.values()));
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // Loopback admin
  if (req.method === 'GET' && url.pathname === '/admin/who') {
    if (!isHostRequest(req)) return send(res, 403, { error: 'host only' });
    return send(res, 200, { presence: Array.from(presence.values()), count: presence.size });
  }

  if (req.method === 'POST' && url.pathname === '/admin/kick') {
    if (!isHostRequest(req)) return send(res, 403, { error: 'host only' });
    try {
      const body = await readBody(req);
      const name = String(body.name || '');
      let killed = 0;
      for (const [id, p] of presence) {
        if (p.display_name === name) { presence.delete(id); killed++; }
      }
      if (killed) broadcast('presence', Array.from(presence.values()));
      broadcast('kicked', { name, count: killed });
      return send(res, 200, { kicked: killed });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/admin/comments') {
    if (!isHostRequest(req)) return send(res, 403, { error: 'host only' });
    return send(res, 200, comments);
  }

  // End the room from the lobby — host only. Spawns `bt end` which kills
  // the server, the cloudflared tunnel, and the transcript tailer.
  if (req.method === 'POST' && url.pathname === '/admin/end-room') {
    if (!isHostRequest(req)) return send(res, 403, { error: 'host only' });
    try {
      const btPath = path.resolve(__dirname, '..', 'bin', 'bt');
      spawn(process.execPath, [btPath, 'end'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  send(res, 404, { error: 'not found' });
});

server.on('clientError', (err, socket) => {
  try { socket.destroy(); } catch (e) {}
});

server.listen(PORT, HOST, () => {
  const port = server.address().port;
  console.log(JSON.stringify({ event: 'listening', port, started_at: STARTED_AT }));
});

// SSE keepalive + presence sweep
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': keepalive\n\n'); } catch (e) { sseClients.delete(res); }
  }
  const now = Date.now();
  let changed = false;
  for (const [id, p] of presence) {
    if (now - new Date(p.last_seen).getTime() > 45000) {
      presence.delete(id);
      changed = true;
    }
  }
  if (changed) broadcast('presence', Array.from(presence.values()));
}, 10000);

function shutdown() {
  broadcast('room_closed', { ts: new Date().toISOString() });
  for (const res of sseClients) { try { res.end(); } catch (e) {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
