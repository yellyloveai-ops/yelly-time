'use strict';
// runtimes/index.js — runAgent() dispatcher + session registration

const { spawn }        = require('child_process');
const { buildCodexArgs }    = require('./codex');
const { buildClaudeArgs, resolveSystemPrompt } = require('./claude');
const { buildGptCodexArgs } = require('./gpt-codex');
const sessionStore     = require('../session-store');
const { getPreapprovedTools } = require('../preapproval');

// Pending token state (shared with routes.js via export)
/** @type {Map<string, {prompt:string, spaceName:string|null, requesterId:string|null, createdAt:number, claimed:boolean}>} */
const pendingTokens = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

function generateToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function storePendingToken(prompt, spaceName, requesterId) {
  const token = generateToken();
  pendingTokens.set(token, { prompt, spaceName: spaceName || null, requesterId: requesterId || null, createdAt: Date.now(), claimed: false });
  return token;
}

function expirePendingTokens() {
  const now = Date.now();
  for (const [token, entry] of pendingTokens) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingTokens.delete(token);
  }
}

/**
 * Core agent execution function.
 *
 * @param {object} opts
 * @param {string}  opts.prompt
 * @param {object}  opts.res            Node.js ServerResponse (for plain-text streaming) or null
 * @param {boolean} opts.asHtml         true → start session and return id; false → stream to res
 * @param {string|null} opts.spaceName
 * @param {string|null} opts.sessionLabel
 * @param {boolean} opts.interactive
 * @param {string|null} opts.currentUrl
 * @param {object}  opts.config         server config object
 * @param {boolean} opts.allowTools
 * @param {'browser'|'schedule'} opts.source
 * @param {string|null} [opts.runtime]  override; defaults to config.RUNTIME
 * @param {string|null} [opts.agentName]
 * @returns {number} sessionId
 */
function runAgent({ prompt, res, asHtml, spaceName, sessionLabel, interactive, currentUrl, config, allowTools, source, runtime, agentName }) {
  const rt      = runtime || config.RUNTIME;
  const model   = config.MODEL || null;
  const workDir = config.WORK_DIR;
  const repoRoot = config.REPO_ROOT;

  // Resolve preapproved tools
  const tools = allowTools ? getPreapprovedTools(currentUrl, prompt) : [];

  // Build args per runtime
  let bin, args;
  if (rt === 'claude-code') {
    bin  = config.CLAUDE_BIN || 'claude';
    const systemPromptFile = resolveSystemPrompt(agentName, repoRoot);
    args = buildClaudeArgs(prompt, interactive, tools, model, systemPromptFile);
  } else if (rt === 'gpt-codex') {
    bin  = config.CODEX_BIN || 'codex';
    args = buildGptCodexArgs(prompt, interactive, model);
  } else {
    // codex-cli (default)
    bin  = config.CODEX_CLI_BIN || 'codex-cli';
    args = buildCodexArgs(prompt, interactive, tools);
  }

  // Spawn process — strip CLAUDECODE so claude-code can run inside a Claude Code session
  const childEnv = { ...process.env };
  delete childEnv.CLAUDECODE;

  const proc = spawn(bin, args, {
    cwd: workDir,
    env: childEnv,
    stdio: asHtml ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });

  // Register session
  const sessionId = sessionStore.registerSession({
    prompt,
    proc,
    interactive,
    source,
    runtime: rt,
    model,
  });

  // Wire up output
  const onData = chunk => {
    sessionStore.appendOutput(sessionId, chunk.toString(), config.INTERACTIVE_MODE);
    if (!asHtml && res && !res.writableEnded) {
      res.write(chunk);
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code, signal) => {
    const exitCode = signal ? null : code;
    sessionStore.closeSession(sessionId, exitCode);

    if (!asHtml && res && !res.writableEnded) {
      res.end(`\n[done] exit code: ${exitCode ?? signal}\n`);
    }

    // Notify schedule store
    try {
      const scheduleStore = require('../schedule-store');
      scheduleStore.onSessionClose(sessionId);
    } catch { /* schedule store may not be in use */ }
  });

  proc.on('error', err => {
    sessionStore.appendOutput(sessionId, `\n[error] ${err.message}\n`, false);
    sessionStore.closeSession(sessionId, 1);
    if (!asHtml && res && !res.writableEnded) {
      res.end(`\n[error] ${err.message}\n`);
    }
  });

  return sessionId;
}

module.exports = { runAgent, pendingTokens, storePendingToken, expirePendingTokens, generateToken };
