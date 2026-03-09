'use strict';
// preapproval.js — Tool preapproval rules (URL glob patterns + prompt keywords)
// Loaded from v1/preapproval-rules.json at startup; pure functions, no I/O after init.

const fs   = require('fs');
const path = require('path');

/** @type {{ urlPatterns: Array<{pattern:string, tools:string[]}>, keywords: Array<{keyword:string, tools:string[]}> }} */
let rules = { urlPatterns: [], keywords: [] };

/**
 * Load preapproval rules from disk. Call once at startup.
 * @param {string} rulesPath  absolute path to preapproval-rules.json
 */
function loadPreapprovalRules(rulesPath) {
  try {
    const raw = fs.readFileSync(rulesPath, 'utf8');
    rules = JSON.parse(raw);
  } catch (err) {
    console.warn(`[preapproval] Could not load rules from ${rulesPath}: ${err.message}`);
    rules = { urlPatterns: [], keywords: [] };
  }
}

/**
 * Convert a simple glob pattern (only * and ** wildcards) to a RegExp.
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]*');
  return new RegExp('^' + escaped + '$', 'i');
}

/**
 * Extract normalized keywords from a prompt string.
 * Lowercase, strip non-word chars, split on whitespace, dedupe, min length 3.
 * @param {string} prompt
 * @returns {string[]}
 */
function extractKeywords(prompt) {
  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);
  return [...new Set(words)];
}

/**
 * Get the merged list of preapproved tools for a given URL and prompt.
 * @param {string|null} url      current page URL (may be null)
 * @param {string}      prompt
 * @returns {string[]}
 */
function getPreapprovedTools(url, prompt) {
  const toolSet = new Set();

  // URL pattern matching
  if (url) {
    for (const rule of rules.urlPatterns || []) {
      try {
        if (globToRegex(rule.pattern).test(url)) {
          for (const t of rule.tools) toolSet.add(t);
        }
      } catch { /* skip bad pattern */ }
    }
  }

  // Keyword matching
  const keywords = extractKeywords(prompt);
  for (const rule of rules.keywords || []) {
    if (keywords.includes(rule.keyword.toLowerCase())) {
      for (const t of rule.tools) toolSet.add(t);
    }
  }

  return [...toolSet];
}

module.exports = { loadPreapprovalRules, extractKeywords, getPreapprovedTools };
