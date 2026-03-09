'use strict';
// html/session.js — Session page HTML generator (live polling + static)
// Two themes: light (browser source), dark Catppuccin Mocha (schedule source)

/**
 * Generate the full session HTML page.
 * @param {object} opts
 * @param {number}  opts.sessionId
 * @param {string}  opts.prompt
 * @param {string}  opts.source     'browser' | 'schedule'
 * @param {string}  opts.runtime
 * @param {string|null} opts.model
 * @param {number}  opts.port
 * @param {boolean} opts.isLive     true → polling enabled
 * @param {string}  opts.output     current output (ANSI stripped)
 * @param {number|null} opts.exitCode
 * @returns {string} HTML
 */
function sessionPage({ sessionId, prompt, source, runtime, model, port, isLive, output, exitCode }) {
  const isDark    = source === 'schedule';
  const badge     = source === 'schedule' ? '⏰ schedule' : '🌐 browser';
  const rtBadge   = runtimeBadge(runtime);
  const modelStr  = model ? ` · ${model}` : '';
  const statusStr = isLive ? 'Running…' : (exitCode === 0 ? 'Done ✓' : `Exit ${exitCode}`);

  const colors = isDark ? {
    bg: '#1e1e2e', fg: '#cdd6f4', panel: '#313244', border: '#45475a',
    accent: '#89b4fa', muted: '#6c7086', toolbar: '#181825', pre: '#11111b',
    btn: '#89b4fa', btnFg: '#1e1e2e',
  } : {
    bg: '#ffffff', fg: '#1e293b', panel: '#f1f5f9', border: '#e2e8f0',
    accent: '#3b82f6', muted: '#64748b', toolbar: '#f8fafc', pre: '#f8fafc',
    btn: '#3b82f6', btnFg: '#ffffff',
  };

  const css = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: ${colors.bg}; color: ${colors.fg}; height: 100vh; display: flex; flex-direction: column; }
    #toolbar { background: ${colors.toolbar}; border-bottom: 1px solid ${colors.border}; padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: ${colors.panel}; border: 1px solid ${colors.border}; color: ${colors.muted}; }
    .badge-accent { background: ${colors.accent}; border-color: ${colors.accent}; color: ${colors.btnFg}; }
    #status { font-size: 13px; color: ${colors.muted}; margin-left: auto; }
    #elapsed { font-size: 12px; color: ${colors.muted}; }
    .btn { padding: 5px 12px; border-radius: 6px; border: 1px solid ${colors.border}; background: ${colors.btn}; color: ${colors.btnFg}; cursor: pointer; font-size: 12px; }
    .btn-ghost { background: transparent; color: ${colors.fg}; }
    #layout { display: flex; flex: 1; overflow: hidden; }
    #sidebar { width: 320px; min-width: 320px; border-right: 1px solid ${colors.border}; padding: 16px; background: ${colors.panel}; overflow-y: auto; }
    #sidebar h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: ${colors.muted}; margin-bottom: 8px; }
    #prompt-text { font-family: monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
    #sidebar .actions { display: flex; gap: 6px; margin-top: 12px; }
    #main { flex: 1; overflow-y: auto; padding: 16px; }
    #output { font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; line-height: 1.6; background: ${colors.pre}; padding: 16px; border-radius: 8px; min-height: 100%; }
    #footer { font-size: 11px; color: ${colors.muted}; padding: 6px 16px; border-top: 1px solid ${colors.border}; background: ${colors.toolbar}; }
  `;

  const completedActions = !isLive ? `
    <button class="btn" onclick="exportSession()">Export Markdown</button>
    <button class="btn btn-ghost" onclick="shareSession()">Share</button>
  ` : `
    <button class="btn btn-ghost" onclick="killSession()">Kill</button>
  `;

  const pollingScript = isLive ? `
    const POLL_MS = 3000;
    let startedAt = Date.now();
    function tick() {
      fetch('/sessions/${sessionId}/logs', { headers: { Accept: 'application/json' } })
        .then(r => r.json())
        .then(data => {
          document.getElementById('output').textContent = data.output || '';
          const main = document.getElementById('main');
          main.scrollTop = main.scrollHeight;
          if (data.exitCode !== undefined && data.exitCode !== null) {
            document.getElementById('status').textContent = data.exitCode === 0 ? 'Done ✓' : 'Exit ' + data.exitCode;
            return; // stop polling
          }
          const secs = Math.round((Date.now() - startedAt) / 1000);
          document.getElementById('elapsed').textContent = secs + 's';
          setTimeout(tick, POLL_MS);
        })
        .catch(() => setTimeout(tick, POLL_MS));
    }
    setTimeout(tick, POLL_MS);
  ` : '';

  const staticScript = `
    function copyPrompt() {
      navigator.clipboard.writeText(${JSON.stringify(prompt)});
    }
    function copyBash() {
      navigator.clipboard.writeText('echo ' + JSON.stringify(${JSON.stringify(prompt)}));
    }
    function killSession() {
      fetch('/sessions/${sessionId}/kill', { method: 'POST', headers: { 'X-YellyTime-Token': window._csrfToken || '' } })
        .then(() => location.reload());
    }
    function exportSession() {
      window.open('/sessions/${sessionId}/export?format=markdown', '_blank');
    }
    function shareSession() {
      fetch('/sessions/${sessionId}/share', { method: 'POST', headers: { 'X-YellyTime-Token': window._csrfToken || '' } })
        .then(r => r.json())
        .then(d => { if (d.url) window.open(d.url, '_blank'); });
    }
    // Fetch CSRF token
    fetch('/token').then(r => r.json()).then(d => { window._csrfToken = d.token; });
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YellyTime #${sessionId}</title>
<style>${css}</style>
</head>
<body>
<div id="toolbar">
  <span class="badge">Session #${sessionId}</span>
  <span class="badge">${h(badge)}</span>
  <span class="badge badge-accent">${h(rtBadge)}${h(modelStr)}</span>
  <span id="status">${h(statusStr)}</span>
  <span id="elapsed"></span>
  ${completedActions}
</div>
<div id="layout">
  <div id="sidebar">
    <h3>Prompt</h3>
    <div id="prompt-text">${h(prompt)}</div>
    <div class="actions">
      <button class="btn btn-ghost" onclick="copyPrompt()">Copy</button>
      <button class="btn btn-ghost" onclick="copyBash()">Copy Bash</button>
    </div>
  </div>
  <div id="main">
    <pre id="output">${h(output)}</pre>
  </div>
</div>
<div id="footer">Session #${sessionId} · port ${port}</div>
<script>${staticScript}${pollingScript}</script>
</body>
</html>`;
}

/**
 * Streaming session page — returned immediately when runAgent() fires in HTML mode.
 * Client-side JS polls /sessions to find the session ID, then polls logs.
 */
function streamingSessionPage({ prompt, port }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>YellyTime — Starting…</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #fff; color: #1e293b; display: flex; flex-direction: column; height: 100vh; }
#toolbar { padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b; }
#main { flex: 1; overflow-y: auto; padding: 16px; }
#output { font-family: monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div id="toolbar" id="status">Starting agent…</div>
<div id="main"><pre id="output"></pre></div>
<script>
const PORT = ${port};
let sessionId = null;

function pollForSession() {
  fetch('/sessions', { headers: { Accept: 'application/json' } })
    .then(r => r.json())
    .then(data => {
      if (data.sessions && data.sessions.length) {
        sessionId = data.sessions[data.sessions.length - 1].id;
        document.getElementById('status').textContent = 'Session #' + sessionId + ' — Running…';
        pollLogs();
      } else {
        setTimeout(pollForSession, 500);
      }
    })
    .catch(() => setTimeout(pollForSession, 1000));
}

function pollLogs() {
  fetch('/sessions/' + sessionId + '/logs', { headers: { Accept: 'application/json' } })
    .then(r => r.json())
    .then(data => {
      document.getElementById('output').textContent = data.output || '';
      const main = document.getElementById('main');
      main.scrollTop = main.scrollHeight;
      if (data.exitCode !== undefined && data.exitCode !== null) {
        document.getElementById('status').textContent = 'Session #' + sessionId + ' — Exit ' + data.exitCode;
        return;
      }
      setTimeout(pollLogs, 2000);
    })
    .catch(() => setTimeout(pollLogs, 2000));
}

pollForSession();
</script>
</body>
</html>`;
}

function runtimeBadge(runtime) {
  if (runtime === 'claude-code') return '🤖 claude';
  if (runtime === 'gpt-codex')  return '🤖 gpt-codex';
  return '🤖 codex-cli';
}

function h(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sessionPage, streamingSessionPage };
