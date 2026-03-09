'use strict';
// runtimes/gpt-codex.js — Argument builder for OpenAI Codex CLI (gpt-codex)

/**
 * Warn at startup if OPENAI_API_KEY is not set and gpt-codex is the active runtime.
 */
function warnIfMissingApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[gpt-codex] WARNING: OPENAI_API_KEY is not set. gpt-codex will fail at runtime.');
  }
}

/**
 * Build CLI args for `codex` (OpenAI Codex CLI).
 * @param {string}      prompt
 * @param {boolean}     interactive
 * @param {string|null} model   e.g. 'o4-mini', 'o3'
 * @returns {string[]}
 */
function buildGptCodexArgs(prompt, interactive, model) {
  const args = [];
  if (!interactive) args.push('--full-auto');
  if (model)        args.push('--model', model);
  args.push(prompt);
  return args;
}

module.exports = { buildGptCodexArgs, warnIfMissingApiKey };
