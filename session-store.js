'use strict';
// session-store.js — Active sessions, session history, disk persistence, idle cleanup

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// ANSI strip
// ---------------------------------------------------------------------------
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g;
function stripAnsi(str) { return str.replace(ANSI_RE, ''); }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
/** @type {Map<number, import('./types').ActiveSession>} */
const activeSessions = new Map();

/** @type {import('./types').HistorySession[]} */
const sessionHistory = [];

const MAX_HISTORY = 50;

/** @type {Map<number, {question:string, timestamp:number}>} */
const pendingInputPrompts = new Map();

let _nextId = 1;
let _sessionDir = path.join(os.homedir(), '.yelly-time', 'sessions');

// Interactive input detection patterns
const INPUT_PATTERNS = [
  /\?[\s]*$/,
  /:[\s]*$/,
  /enter\s+\w+/i,
  /input:/i,
  /provide\s+\w+/i,
  /\(y\/n\)/i,
  /press\s+enter/i,
  /continue\?/i,
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function setSessionDir(dir) {
  _sessionDir = dir;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/**
 * Register a new active session.
 * @param {{ prompt:string, proc:object, interactive:boolean, source:'browser'|'schedule', runtime:string, model?:string }} opts
 * @returns {number} sessionId
 */
function registerSession({ prompt, proc, interactive, source, runtime, model }) {
  const id = _nextId++;
  activeSessions.set(id, {
    id,
    prompt,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    proc,
    outputChunks: [],
    output: '',
    interactive,
    pendingInput: false,
    stdinQueue: [],
    source,
    runtime,
    model: model || null,
    killed: false,
  });
  return id;
}

/**
 * Append output chunk to a session and detect interactive input prompts.
 * @param {number} id
 * @param {string} chunk
 * @param {boolean} interactiveMode  server-level --interactive flag
 */
function appendOutput(id, chunk, interactiveMode) {
  const session = activeSessions.get(id);
  if (!session) return;
  session.outputChunks.push(chunk);
  session.output = session.outputChunks.join('');
  session.lastActivityAt = Date.now();

  if (interactiveMode) {
    const clean = stripAnsi(chunk).trim();
    if (INPUT_PATTERNS.some(p => p.test(clean))) {
      session.pendingInput = true;
      pendingInputPrompts.set(id, { question: clean, timestamp: Date.now() });
    }
  }
}

/**
 * Close a session and move it to history.
 * @param {number} id
 * @param {number|string|null} exitCode
 */
function closeSession(id, exitCode) {
  const session = activeSessions.get(id);
  if (!session) return;

  const endedAt = Date.now();
  const history = {
    id: session.id,
    prompt: session.prompt,
    startedAt: session.startedAt,
    endedAt,
    exitCode,
    killed: session.killed || false,
    output: stripAnsi(session.output),
    source: session.source,
    runtime: session.runtime,
    model: session.model,
  };

  sessionHistory.unshift(history);
  if (sessionHistory.length > MAX_HISTORY) sessionHistory.pop();

  activeSessions.delete(id);
  pendingInputPrompts.delete(id);

  saveSessionToDisk(history);
}

// ---------------------------------------------------------------------------
// Kill
// ---------------------------------------------------------------------------
function killSession(id) {
  const session = activeSessions.get(id);
  if (!session) return false;
  session.killed = true;
  try { session.proc.kill('SIGTERM'); } catch { /* already gone */ }
  return true;
}

// ---------------------------------------------------------------------------
// Idle cleanup
// ---------------------------------------------------------------------------
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function cleanupIdleSessions() {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.lastActivityAt >= IDLE_TIMEOUT_MS) {
      console.log(`[sessions] Killing idle session #${id} (idle ${Math.round((now - session.lastActivityAt) / 60000)}min)`);
      killSession(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------
function saveSessionToDisk(history) {
  try {
    const date = new Date(history.startedAt).toISOString().slice(0, 10);
    const dir  = path.join(_sessionDir, date);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `session-${history.id}.yaml`);
    const durationSeconds = Math.round((history.endedAt - history.startedAt) / 1000);
    const yaml = [
      `id: ${history.id}`,
      `startedAt: "${new Date(history.startedAt).toISOString()}"`,
      `endedAt: "${new Date(history.endedAt).toISOString()}"`,
      `durationSeconds: ${durationSeconds}`,
      `exitCode: ${history.exitCode ?? 'null'}`,
      `killed: ${history.killed}`,
      `runtime: ${history.runtime}`,
      history.model ? `model: ${history.model}` : null,
      `prompt: ${yamlString(history.prompt)}`,
      `output: ${yamlString(history.output)}`,
    ].filter(Boolean).join('\n');
    fs.writeFileSync(file, yaml + '\n', 'utf8');
  } catch (err) {
    console.warn(`[sessions] Failed to save session #${history.id} to disk: ${err.message}`);
  }
}

function yamlString(str) {
  // Multi-line: use literal block scalar
  if (str.includes('\n')) {
    const indented = str.split('\n').map(l => '  ' + l).join('\n');
    return `|\n${indented}`;
  }
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  activeSessions,
  sessionHistory,
  pendingInputPrompts,
  setSessionDir,
  registerSession,
  appendOutput,
  closeSession,
  killSession,
  cleanupIdleSessions,
  stripAnsi,
};
