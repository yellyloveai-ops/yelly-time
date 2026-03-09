'use strict';
// runtimes/claude.js — Argument builder for claude-code (Claude Code CLI)

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Build CLI args for `claude` (Claude Code non-interactive mode).
 * @param {string}      prompt
 * @param {boolean}     interactive
 * @param {string[]}    tools
 * @param {string|null} model       e.g. 'claude-opus-4-6', 'claude-sonnet-4-6'
 * @param {string|null} systemPromptFile  path to agent system prompt file
 * @returns {string[]}
 */
function buildClaudeArgs(prompt, interactive, tools, model, systemPromptFile) {
  const args = [];
  if (!interactive) args.push('--print');
  if (model)        args.push('--model', model);
  if (tools.length) args.push('--allowedTools', tools.join(','));
  if (systemPromptFile && fs.existsSync(systemPromptFile)) {
    args.push('--system-prompt', systemPromptFile);
  }
  args.push('-p', prompt);
  return args;
}

/**
 * Resolve a system prompt file from the agents/ directory.
 * @param {string|null} agentName
 * @param {string}      repoRoot   path to the userscripts repo root
 * @returns {string|null}          absolute path or null if not found
 */
function resolveSystemPrompt(agentName, repoRoot) {
  if (!agentName) return null;
  const candidates = [
    path.join(repoRoot, 'agents', `${agentName}.md`),
    path.join(repoRoot, 'agents', `${agentName}.txt`),
    path.join(repoRoot, 'agents', agentName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

module.exports = { buildClaudeArgs, resolveSystemPrompt };
