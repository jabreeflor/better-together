const fs = require('fs');
const path = require('path');
const os = require('os');

function dataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  return path.join(os.homedir(), '.claude/plugins/data/better-together');
}

function statePath() {
  return path.join(dataDir(), 'state.json');
}

function ensureDataDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { host: null, watch: null };
    throw e;
  }
}

function write(s) {
  ensureDataDir();
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2));
}

function setHost(patch) {
  const s = read();
  s.host = patch ? { ...(s.host || {}), ...patch } : null;
  write(s);
  return s;
}

function setWatch(patch) {
  const s = read();
  s.watch = patch ? { ...(s.watch || {}), ...patch } : null;
  write(s);
  return s;
}

module.exports = { dataDir, statePath, read, write, setHost, setWatch };
