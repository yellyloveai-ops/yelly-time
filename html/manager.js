'use strict';
// html/manager.js — Server Manager SPA (dark theme, schedules + sessions tabs)

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.csrfToken
 * @param {string} opts.runtime
 * @param {string|null} opts.model
 * @param {object} opts.runtimes  availability map from /health
 */
function managerPage({ port, csrfToken, runtime, model, runtimes }) {
  const modelStr = model ? ` · ${model}` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YellyTime Manager</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #1e1e2e; --surface: #313244; --overlay: #45475a;
  --fg: #cdd6f4; --muted: #6c7086; --accent: #89b4fa;
  --green: #a6e3a1; --red: #f38ba8; --yellow: #f9e2af;
  --border: #45475a; --toolbar: #181825;
}
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); height: 100vh; display: flex; flex-direction: column; }
#toolbar { background: var(--toolbar); border-bottom: 1px solid var(--border); padding: 10px 16px; display: flex; align-items: center; gap: 10px; }
#toolbar h1 { font-size: 15px; font-weight: 600; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); }
.badge-green { background: var(--green); color: #1e1e2e; border-color: var(--green); }
.badge-red   { background: var(--red);   color: #1e1e2e; border-color: var(--red); }
#rt-info { font-size: 12px; color: var(--muted); margin-left: 6px; }
.btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--accent); color: #1e1e2e; cursor: pointer; font-size: 12px; font-weight: 500; }
.btn-ghost { background: transparent; color: var(--fg); }
.btn-danger { background: var(--red); border-color: var(--red); color: #1e1e2e; }
.btn-sm { padding: 3px 8px; font-size: 11px; }
#tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--toolbar); }
.tab { padding: 8px 20px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--muted); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
#content { flex: 1; overflow-y: auto; padding: 16px; }
.panel { display: none; }
.panel.active { display: block; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 6px 10px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:hover td { background: var(--surface); }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dot-green { background: var(--green); }
.dot-red   { background: var(--red); }
.dot-yellow { background: var(--yellow); }
.actions-row { display: flex; gap: 4px; flex-wrap: wrap; }
.section-title { font-size: 13px; font-weight: 600; margin: 16px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
/* Modal */
.modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; align-items: center; justify-content: center; }
.modal-backdrop.open { display: flex; }
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 24px; width: 520px; max-width: 95vw; }
.modal h2 { font-size: 15px; margin-bottom: 16px; }
.form-row { margin-bottom: 12px; }
label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
input, select, textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--fg); padding: 7px 10px; font-size: 13px; font-family: inherit; }
textarea { min-height: 80px; resize: vertical; }
.form-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
#model-row { display: none; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>🚀 YellyTime</h1>
  <span class="badge badge-green" id="health-badge">● ok</span>
  <span class="badge">${h(runtime)}${h(modelStr)}</span>
  <span id="rt-info"></span>
  <div style="margin-left:auto;display:flex;gap:8px">
    <button class="btn btn-ghost btn-sm" onclick="checkHealth()">Health</button>
    <button class="btn btn-danger btn-sm" onclick="stopServer()">Stop Server</button>
  </div>
</div>
<div id="tabs">
  <div class="tab active" onclick="showTab('schedules')">Schedules</div>
  <div class="tab" onclick="showTab('sessions')">Sessions</div>
</div>
<div id="content">
  <div id="panel-schedules" class="panel active">
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn btn-sm" onclick="openAddModal()">+ Add Schedule</button>
    </div>
    <table id="schedules-table">
      <thead><tr>
        <th>Name</th><th>Prompt</th><th>Runtime</th><th>Interval</th>
        <th>Next Run</th><th>Last Run</th><th>Runs</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody id="schedules-body"><tr><td colspan="9" style="color:var(--muted);padding:20px;text-align:center">Loading…</td></tr></tbody>
    </table>
  </div>
  <div id="panel-sessions" class="panel">
    <div class="section-title">Active</div>
    <table>
      <thead><tr><th>#</th><th>Prompt</th><th>Runtime</th><th>Source</th><th>Started</th><th>Actions</th></tr></thead>
      <tbody id="active-body"><tr><td colspan="6" style="color:var(--muted);padding:20px;text-align:center">Loading…</td></tr></tbody>
    </table>
    <div class="section-title" style="margin-top:24px">History</div>
    <table>
      <thead><tr><th>#</th><th>Prompt</th><th>Runtime</th><th>Exit</th><th>Duration</th><th>Actions</th></tr></thead>
      <tbody id="history-body"><tr><td colspan="6" style="color:var(--muted);padding:20px;text-align:center">Loading…</td></tr></tbody>
    </table>
  </div>
</div>

<!-- Add/Edit Schedule Modal -->
<div class="modal-backdrop" id="schedule-modal">
  <div class="modal">
    <h2 id="modal-title">Add Schedule</h2>
    <input type="hidden" id="modal-schedule-id">
    <div class="form-row"><label>Name</label><input id="f-name" placeholder="Daily standup"></div>
    <div class="form-row"><label>Prompt</label><textarea id="f-prompt" placeholder="Summarize my open tasks"></textarea></div>
    <div class="form-row"><label>Runtime</label>
      <select id="f-runtime" onchange="onRuntimeChange()">
        <option value="">Server default (${h(runtime)})</option>
        <option value="codex-cli">codex-cli</option>
        <option value="claude-code">claude-code</option>
        <option value="gpt-codex">gpt-codex</option>
      </select>
    </div>
    <div class="form-row" id="model-row"><label>Model</label><input id="f-model" placeholder="e.g. claude-sonnet-4-6, o4-mini"></div>
    <div class="form-row"><label>Frequency</label>
      <select id="f-interval">
        <option value="30m">Every 30 minutes</option>
        <option value="1h" selected>Every hour</option>
        <option value="6h">Every 6 hours</option>
        <option value="12h">Every 12 hours</option>
        <option value="1d">Daily</option>
        <option value="1w">Weekly</option>
        <option value="once">Once</option>
      </select>
    </div>
    <div class="form-row" id="once-row" style="display:none">
      <label>Run At</label><input type="datetime-local" id="f-next-run-at">
    </div>
    <div class="form-row"><label><input type="checkbox" id="f-allow-tools"> Allow tools (preapproval rules)</label></div>
    <div class="form-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveSchedule()">Save</button>
    </div>
  </div>
</div>

<script>
const PORT = ${port};
const TOKEN = ${JSON.stringify(csrfToken)};

// ── Tabs ──────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', ['schedules','sessions'][i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

// ── Health ─────────────────────────────────────────────────────────────────
function checkHealth() {
  fetch('/health').then(r => r.json()).then(d => {
    const badge = document.getElementById('health-badge');
    badge.textContent = d.status === 'ok' ? '● ok · ' + d.sessions + ' sessions' : '● error';
    badge.className = 'badge ' + (d.status === 'ok' ? 'badge-green' : 'badge-red');
  }).catch(() => {
    document.getElementById('health-badge').textContent = '● unreachable';
    document.getElementById('health-badge').className = 'badge badge-red';
  });
}

function stopServer() {
  if (!confirm('Stop the YellyTime server?')) return;
  fetch('/stop', { method: 'POST', headers: { 'X-YellyTime-Token': TOKEN } });
}

// ── Schedules ─────────────────────────────────────────────────────────────
let schedulesRefreshTimer;
function loadSchedules() {
  fetch('/schedules').then(r => r.json()).then(data => {
    const tbody = document.getElementById('schedules-body');
    if (!data.schedules || !data.schedules.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="color:var(--muted);padding:20px;text-align:center">No schedules yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.schedules.map(s => {
      const nextRun = s.nextRunAt && isFinite(s.nextRunAt) ? new Date(s.nextRunAt).toLocaleString() : '—';
      const lastRun = s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—';
      const dot = s.enabled ? (s.currentRunSessionId ? 'dot-yellow' : 'dot-green') : 'dot-red';
      const status = s.enabled ? (s.currentRunSessionId ? 'Running' : 'Active') : 'Paused';
      const rt = s.runtime || '(default)';
      return \`<tr>
        <td>\${h(s.name)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${h(s.prompt)}</td>
        <td><span class="badge">\${h(rt)}</span></td>
        <td>\${h(s.interval)}</td>
        <td style="font-size:11px">\${h(nextRun)}</td>
        <td style="font-size:11px">\${h(lastRun)}</td>
        <td>\${s.runCount || 0}</td>
        <td><span class="status-dot \${dot}"></span>\${h(status)}</td>
        <td><div class="actions-row">
          <button class="btn btn-sm btn-ghost" onclick="togglePause('\${h(s.id)}')">⏸</button>
          <button class="btn btn-sm" onclick="manualRun('\${h(s.id)}')">▶</button>
          <button class="btn btn-sm btn-ghost" onclick="editSchedule(\${JSON.stringify(s).replace(/</g,'\\\\u003c')})">✎</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSchedule('\${h(s.id)}')">✕</button>
        </div></td>
      </tr>\`;
    }).join('');
  });
}

function togglePause(id) {
  fetch('/schedules/' + id + '/pause', { method: 'POST', headers: { 'X-YellyTime-Token': TOKEN } })
    .then(() => loadSchedules());
}
function manualRun(id) {
  fetch('/schedules/' + id + '/run', { method: 'POST', headers: { 'X-YellyTime-Token': TOKEN } })
    .then(r => r.json()).then(d => { alert(d.error || ('Triggered session #' + d.sessionId)); loadSchedules(); });
}
function deleteSchedule(id) {
  if (!confirm('Delete this schedule?')) return;
  fetch('/schedules/' + id + '?action=delete', { method: 'DELETE', headers: { 'X-YellyTime-Token': TOKEN } })
    .then(() => loadSchedules());
}

// ── Sessions ──────────────────────────────────────────────────────────────
function loadSessions() {
  fetch('/sessions').then(r => r.json()).then(data => {
    const tbody = document.getElementById('active-body');
    if (!data.sessions || !data.sessions.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:12px;text-align:center">No active sessions</td></tr>';
    } else {
      tbody.innerHTML = data.sessions.map(s => \`<tr>
        <td>#\${s.id}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${h(s.prompt)}</td>
        <td><span class="badge">🤖 \${h(s.runtime || 'codex-cli')}</span></td>
        <td><span class="badge">\${s.source === 'schedule' ? '⏰ schedule' : '🌐 browser'}</span></td>
        <td style="font-size:11px">\${new Date(s.startedAt).toLocaleString()}</td>
        <td><button class="btn btn-sm btn-danger" onclick="killSession(\${s.id})">Kill</button>
            <a href="/sessions/\${s.id}/logs" target="_blank"><button class="btn btn-sm btn-ghost">Logs</button></a></td>
      </tr>\`).join('');
    }
  });
  fetch('/history').then(r => r.json()).then(data => {
    const tbody = document.getElementById('history-body');
    if (!data.history || !data.history.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:12px;text-align:center">No history</td></tr>';
    } else {
      tbody.innerHTML = data.history.map(s => {
        const dur = s.endedAt ? Math.round((s.endedAt - s.startedAt) / 1000) + 's' : '—';
        return \`<tr>
          <td>#\${s.id}</td>
          <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${h(s.prompt)}</td>
          <td><span class="badge">🤖 \${h(s.runtime || 'codex-cli')}</span></td>
          <td>\${s.killed ? '🔴 killed' : (s.exitCode === 0 ? '✅ 0' : '🔴 ' + s.exitCode)}</td>
          <td>\${dur}</td>
          <td><a href="/sessions/\${s.id}/logs" target="_blank"><button class="btn btn-sm btn-ghost">Logs</button></a>
              <a href="/sessions/\${s.id}/export?format=markdown" target="_blank"><button class="btn btn-sm btn-ghost">Export</button></a></td>
        </tr>\`;
      }).join('');
    }
  });
}

function killSession(id) {
  fetch('/sessions/' + id + '/kill', { method: 'POST', headers: { 'X-YellyTime-Token': TOKEN } })
    .then(() => loadSessions());
}

// ── Schedule Modal ─────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('modal-title').textContent = 'Add Schedule';
  document.getElementById('modal-schedule-id').value = '';
  ['f-name','f-prompt','f-model'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-runtime').value = '';
  document.getElementById('f-interval').value = '1h';
  document.getElementById('f-allow-tools').checked = false;
  document.getElementById('once-row').style.display = 'none';
  document.getElementById('model-row').style.display = 'none';
  document.getElementById('schedule-modal').classList.add('open');
}

function editSchedule(s) {
  document.getElementById('modal-title').textContent = 'Edit Schedule';
  document.getElementById('modal-schedule-id').value = s.id;
  document.getElementById('f-name').value = s.name || '';
  document.getElementById('f-prompt').value = s.prompt || '';
  document.getElementById('f-runtime').value = s.runtime || '';
  document.getElementById('f-model').value = s.model || '';
  document.getElementById('f-interval').value = s.interval || '1h';
  document.getElementById('f-allow-tools').checked = !!s.allowTools;
  onRuntimeChange();
  document.getElementById('schedule-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('schedule-modal').classList.remove('open');
}

function onRuntimeChange() {
  const rt = document.getElementById('f-runtime').value;
  document.getElementById('model-row').style.display = (rt === 'claude-code' || rt === 'gpt-codex') ? 'block' : 'none';
  const interval = document.getElementById('f-interval').value;
  document.getElementById('once-row').style.display = interval === 'once' ? 'block' : 'none';
}

document.getElementById('f-interval').addEventListener('change', onRuntimeChange);

function saveSchedule() {
  const id = document.getElementById('modal-schedule-id').value;
  const body = {
    name: document.getElementById('f-name').value,
    prompt: document.getElementById('f-prompt').value,
    interval: document.getElementById('f-interval').value,
    allowTools: document.getElementById('f-allow-tools').checked,
    runtime: document.getElementById('f-runtime').value || undefined,
    model: document.getElementById('f-model').value || undefined,
  };
  const nextRunAt = document.getElementById('f-next-run-at').value;
  if (nextRunAt) body.nextRunAt = new Date(nextRunAt).toISOString();

  const url    = id ? '/schedules/' + id : '/schedules';
  const method = 'POST';
  fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-YellyTime-Token': TOKEN }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(d => { if (d.error) { alert(d.error); return; } closeModal(); loadSchedules(); });
}

// ── Utilities ─────────────────────────────────────────────────────────────
function h(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auto-refresh ──────────────────────────────────────────────────────────
loadSchedules();
loadSessions();
checkHealth();
setInterval(loadSchedules, 10_000);
setInterval(loadSessions,   5_000);
setInterval(checkHealth,   30_000);
</script>
</body>
</html>`;
}

function h(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { managerPage };
