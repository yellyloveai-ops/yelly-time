'use strict';
// runtimes/codex.js — Argument builder for codex-cli

/**
 * Build CLI args for codex-cli.
 * @param {string}   prompt
 * @param {boolean}  interactive
 * @param {string[]} tools
 * @returns {string[]}
 */
function buildCodexArgs(prompt, interactive, tools) {
  const args = [];
  if (!interactive) args.push('--no-interactive');
  if (tools.length)  args.push('--trust-tools', tools.join(','));
  args.push(prompt);
  return args;
}

module.exports = { buildCodexArgs };
