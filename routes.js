'use strict';
// routes.js — HTTP router + all route handlers

const { validateSecurity } = require('./security');
const sessionStore = require('./session-store');
const scheduleStore = require('./schedule-store');
const { runAgent, pendingTokens, storePendingToken, expirePendingTokens } = require('./runtimes/index');
const { sessionPage, streamingSessionPage } = require('./html/session');
const { managerPage } = require('./html/manager');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function send(res, status, body, contentType = 'application/json') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(html);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1_048_576) req.destroy(); });
    req.on('end', () => {
      try {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json')) resolve(JSON.parse(data || '{}'));
        else if (ct.includes('application/x-www-form-urlencoded')) {
          resolve(Object.fromEntries(new URLSearchParams(data)));
        } else resolve({});
      } catch { reject(new Error('Invalid body')); }
    });
    req.on('error', reject);
  });
}

function sessionIdParam(pathname) {
  const m = pathname.match(/^\/sessions\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function scheduleIdParam(pathname) {
  const m = pathname.match(/^\/schedules\/([^/]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function createRouter(config) {
  return async function router(req, res) {
    const parsed   = new URL(req.url, `http://127.0.0.1:${config.PORT}`);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query    = Object.fromEntries(parsed.searchParams);
    const method   = req.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-YellyTime-Token' });
      return res.end();
    }

    // Security validation
    const secErr = validateSecurity(req, config.PORT, config.ALLOWED_DOMAINS, config.CSRF_TOKEN, config.rateLimitCounters);
    if (secErr) return send(res, secErr.status, { error: secErr.message });

    // ── GET /token ──────────────────────────────────────────────────────
    if (pathname === '/token' && method === 'GET') {
      return send(res, 200, { token: config.CSRF_TOKEN });
    }

    // ── GET /health ─────────────────────────────────────────────────────
    if (pathname === '/health' && method === 'GET') {
      return send(res, 200, {
        status: 'ok',
        runtime: config.RUNTIME,
        bin: config.activeBin || config.CODEX_CLI_BIN,
        model: config.MODEL || null,
        port: config.PORT,
        sessions: sessionStore.activeSessions.size,
        workDir: config.WORK_DIR,
        runtimes: config.runtimeAvailability || {},
      });
    }

    // ── POST /stop ──────────────────────────────────────────────────────
    if (pathname === '/stop' && method === 'POST') {
      for (const [id] of sessionStore.activeSessions) sessionStore.killSession(id);
      send(res, 200, { ok: true });
      setTimeout(() => config.server && config.server.close(() => process.exit(0)), 100);
      return;
    }

    // ── GET /agents ─────────────────────────────────────────────────────
    if (pathname === '/agents' && method === 'GET') {
      const agentsDir = path.join(config.REPO_ROOT, 'agents');
      let agents = [];
      try {
        agents = fs.readdirSync(agentsDir)
          .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
          .map(f => ({ name: f.replace(/\.(md|txt)$/, '') }));
      } catch { /* no agents dir */ }
      return send(res, 200, { agents });
    }

    // ── GET / or /yelly-time ─────────────────────────────────────────────
    if ((pathname === '/' || pathname === '/yelly-time') && method === 'GET') {
      expirePendingTokens();

      if (query.initialPrompt) {
        const token = storePendingToken(query.initialPrompt, query.spaceName || null, query.requesterId || null);
        res.writeHead(302, { Location: `/yelly-time?sessionId=${encodeURIComponent(token)}` });
        return res.end();
      }

      if (query.sessionId) {
        const token = query.sessionId;

        // Check if token maps to a numeric session id
        // (After claim, pendingTokens entry has a sessionId added)
        const entry = pendingTokens.get(token);

        if (entry && entry.sessionId) {
          // Already started — serve the session page
          const sid = entry.sessionId;
          const active = sessionStore.activeSessions.get(sid);
          const hist   = sessionStore.sessionHistory.find(s => s.id === sid);
          const s      = active || hist;
          if (s) {
            return sendHtml(res, 200, sessionPage({
              sessionId: sid,
              prompt: s.prompt,
              source: s.source,
              runtime: s.runtime,
              model: s.model,
              port: config.PORT,
              isLive: !!active,
              output: sessionStore.stripAnsi(s.output || ''),
              exitCode: hist ? hist.exitCode : null,
            }));
          }
        }

        if (entry && !entry.claimed) {
          entry.claimed = true;
          const sessionId = runAgent({
            prompt: entry.prompt,
            res: null,
            asHtml: true,
            spaceName: entry.spaceName,
            sessionLabel: null,
            interactive: config.INTERACTIVE_MODE,
            currentUrl: null,
            config,
            allowTools: true,
            source: 'browser',
            runtime: config.RUNTIME,
          });
          entry.sessionId = sessionId;
          return sendHtml(res, 200, streamingSessionPage({ prompt: entry.prompt, port: config.PORT }));
        }

        if (entry && entry.claimed) {
          return sendHtml(res, 200, `<html><body><h2>Session In Progress</h2><p>Session is already running. <a href="/yelly-time?sessionId=${encodeURIComponent(token)}">Refresh</a></p></body></html>`);
        }

        // Token not found or expired
        return send(res, 410, { error: 'Token expired or not found' });
      }

      // No params → Server Manager
      return sendHtml(res, 200, managerPage({
        port: config.PORT,
        csrfToken: config.CSRF_TOKEN,
        runtime: config.RUNTIME,
        model: config.MODEL || null,
        runtimes: config.runtimeAvailability || {},
      }));
    }

    // ── POST /run ─────────────────────────────────────────────────────────
    if (pathname === '/run' && method === 'POST') {
      let body;
      try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid body' }); }
      const prompt = body.prompt;
      if (!prompt) return send(res, 400, { error: 'prompt is required' });

      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/x-www-form-urlencoded')) {
        res.writeHead(303, { Location: `/yelly-time?initialPrompt=${encodeURIComponent(prompt)}` });
        return res.end();
      }

      // JSON → stream plain text
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      runAgent({ prompt, res, asHtml: false, spaceName: null, sessionLabel: null, interactive: config.INTERACTIVE_MODE, currentUrl: null, config, allowTools: true, source: 'browser', runtime: config.RUNTIME });
      return;
    }

    // ── GET /sessions ─────────────────────────────────────────────────────
    if (pathname === '/sessions' && method === 'GET') {
      const sessions = [...sessionStore.activeSessions.values()].map(s => ({
        id: s.id, prompt: s.prompt, startedAt: s.startedAt, interactive: s.interactive,
        pendingInput: s.pendingInput, source: s.source, inputPrompt: null,
        runtime: s.runtime, model: s.model,
      }));
      return send(res, 200, { sessions });
    }

    // ── /sessions/:id/* ───────────────────────────────────────────────────
    const sid = sessionIdParam(pathname);
    if (sid !== null) {
      const subpath = pathname.replace(`/sessions/${sid}`, '') || '/';

      // GET /sessions/:id/logs
      if (subpath === '/logs' && method === 'GET') {
        const active = sessionStore.activeSessions.get(sid);
        const hist   = sessionStore.sessionHistory.find(s => s.id === sid);
        if (!active && !hist) return send(res, 404, { error: 'Session not found' });
        const accept = req.headers['accept'] || '';
        if (accept.includes('text/html')) {
          const s = active || hist;
          return sendHtml(res, 200, sessionPage({
            sessionId: sid, prompt: s.prompt, source: s.source,
            runtime: s.runtime, model: s.model, port: config.PORT,
            isLive: !!active, output: sessionStore.stripAnsi(s.output || ''),
            exitCode: hist ? hist.exitCode : null,
          }));
        }
        if (active) return send(res, 200, { id: sid, prompt: active.prompt, output: sessionStore.stripAnsi(active.output), startedAt: active.startedAt, runtime: active.runtime });
        return send(res, 200, { id: sid, prompt: hist.prompt, exitCode: hist.exitCode, output: hist.output, runtime: hist.runtime });
      }

      // GET /sessions/:id/input
      if (subpath === '/input' && method === 'GET') {
        const session = sessionStore.activeSessions.get(sid);
        if (!session) return send(res, 404, { error: 'Session not found' });
        const pi = sessionStore.pendingInputPrompts.get(sid);
        return send(res, 200, { id: sid, pendingInput: session.pendingInput, question: pi ? pi.question : null, timestamp: pi ? pi.timestamp : null });
      }

      // POST /sessions/:id/input
      if (subpath === '/input' && method === 'POST') {
        const session = sessionStore.activeSessions.get(sid);
        if (!session) return send(res, 404, { error: 'Session not found' });
        if (!session.interactive) return send(res, 400, { error: 'Session not in interactive mode' });
        let body;
        try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid body' }); }
        if (!body.input) return send(res, 400, { error: 'input is required' });
        try {
          session.proc.stdin.write(body.input + '\n');
          session.pendingInput = false;
          sessionStore.pendingInputPrompts.delete(sid);
          return send(res, 200, { ok: true });
        } catch { return send(res, 400, { error: 'stdin not writable' }); }
      }

      // GET /sessions/:id/export
      if (subpath === '/export' && method === 'GET') {
        const hist = sessionStore.sessionHistory.find(s => s.id === sid);
        if (!hist) return send(res, 404, { error: 'Session not found in history' });
        const fmt = query.format || 'json';
        if (fmt === 'markdown') {
          const dur = Math.round((hist.endedAt - hist.startedAt) / 1000);
          const md  = `# YellyTime Session #${hist.id}\n\n## Session Details\n- **Started:** ${new Date(hist.startedAt).toISOString()}\n- **Ended:** ${new Date(hist.endedAt).toISOString()}\n- **Duration:** ${dur}s\n- **Status:** ${hist.killed ? 'killed' : 'exit ' + hist.exitCode}\n- **Runtime:** ${hist.runtime}\n\n## Prompt\n\`\`\`\n${hist.prompt}\n\`\`\`\n\n## Output\n\`\`\`\n${hist.output}\n\`\`\`\n`;
          res.writeHead(200, { 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="session-${sid}.md"`, 'Access-Control-Allow-Origin': '*' });
          return res.end(md);
        }
        if (fmt === 'text') {
          const dur = Math.round((hist.endedAt - hist.startedAt) / 1000);
          const txt = `${'='.repeat(60)}\nYellyTime Session #${hist.id}\n${'='.repeat(60)}\nStarted: ${new Date(hist.startedAt).toISOString()}\nEnded: ${new Date(hist.endedAt).toISOString()}\nDuration: ${dur}s\nRuntime: ${hist.runtime}\n${'-'.repeat(60)}\nPROMPT\n${'-'.repeat(60)}\n${hist.prompt}\n${'-'.repeat(60)}\nOUTPUT\n${'-'.repeat(60)}\n${hist.output}\n`;
          res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="session-${sid}.txt"`, 'Access-Control-Allow-Origin': '*' });
          return res.end(txt);
        }
        // JSON (default)
        const dur = Math.round((hist.endedAt - hist.startedAt) / 1000);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="session-${sid}.json"`, 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ sessionId: hist.id, prompt: hist.prompt, startedAt: new Date(hist.startedAt).toISOString(), endedAt: new Date(hist.endedAt).toISOString(), durationSeconds: dur, exitCode: hist.exitCode, killed: hist.killed, output: hist.output, runtime: hist.runtime }));
      }

      // POST /sessions/:id/share
      if (subpath === '/share' && method === 'POST') {
        const hist = sessionStore.sessionHistory.find(s => s.id === sid);
        if (!hist) return send(res, 404, { error: 'Session not found in history' });
        const dur = Math.round((hist.endedAt - hist.startedAt) / 1000);
        const md  = `# YellyTime Session #${hist.id}\n\n**Runtime:** ${hist.runtime}  **Duration:** ${dur}s  **Exit:** ${hist.exitCode}\n\n## Prompt\n\`\`\`\n${hist.prompt}\n\`\`\`\n\n## Output\n\`\`\`\n${hist.output}\n\`\`\`\n`;
        // Post to dpaste.com (no auth required, returns JSON with URL)
        try {
          const https = require('https');
          const postData = new URLSearchParams({ content: md, syntax: 'markdown', expiry_days: '7' }).toString();
          const pasteUrl = await new Promise((resolve, reject) => {
            const req2 = https.request({ hostname: 'dpaste.com', path: '/api/v2/', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, r2 => {
              let d = '';
              r2.on('data', c => d += c);
              r2.on('end', () => resolve(r2.headers.location || JSON.parse(d).url));
            });
            req2.on('error', reject);
            req2.write(postData);
            req2.end();
          });
          return send(res, 200, { url: pasteUrl, id: sid });
        } catch (err) {
          return send(res, 500, { error: 'Share failed: ' + err.message });
        }
      }

      // POST|DELETE /sessions/:id/kill
      if (subpath === '/kill' && (method === 'POST' || method === 'DELETE')) {
        const ok = sessionStore.killSession(sid);
        if (!ok) return send(res, 404, { error: 'Session not found or already ended' });
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: 'Unknown sessions sub-route' });
    }

    // ── GET /history ──────────────────────────────────────────────────────
    if (pathname === '/history' && method === 'GET') {
      return send(res, 200, { history: sessionStore.sessionHistory.map(s => ({ id: s.id, prompt: s.prompt, startedAt: s.startedAt, endedAt: s.endedAt, exitCode: s.exitCode, killed: s.killed, source: s.source, runtime: s.runtime })) });
    }

    if (pathname === '/history/clear' && (method === 'POST' || method === 'DELETE')) {
      sessionStore.sessionHistory.length = 0;
      return send(res, 200, { ok: true });
    }

    // ── Schedules ─────────────────────────────────────────────────────────
    if (pathname === '/schedules' && method === 'GET') {
      const schedules = [...scheduleStore.scheduledTasks.values()].map(s => ({
        ...s,
        nextRunAt: isFinite(s.nextRunAt) ? s.nextRunAt : null,
      }));
      return send(res, 200, { schedules, scheduleFile: scheduleStore.getScheduleFilePath(), alias: config.ALIAS });
    }

    if (pathname === '/schedules' && method === 'POST') {
      let body;
      try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid body' }); }
      try {
        const schedule = scheduleStore.createSchedule(body);
        scheduleStore.saveSchedules().catch(() => {});
        return send(res, 201, { schedule });
      } catch (err) { return send(res, 400, { error: err.message }); }
    }

    const schId = scheduleIdParam(pathname);
    if (schId) {
      const subpath = pathname.replace(`/schedules/${schId}`, '') || '/';

      if (subpath === '/' && method === 'POST') {
        let body;
        try { body = await parseBody(req); } catch { return send(res, 400, { error: 'Invalid body' }); }
        if (query.action === 'delete' || method === 'DELETE') {
          scheduleStore.deleteSchedule(schId);
          scheduleStore.saveSchedules().catch(() => {});
          return send(res, 200, { ok: true });
        }
        try {
          const schedule = scheduleStore.updateSchedule(schId, body);
          if (!schedule) return send(res, 404, { error: 'Schedule not found' });
          scheduleStore.saveSchedules().catch(() => {});
          return send(res, 200, { schedule });
        } catch (err) { return send(res, 400, { error: err.message }); }
      }

      if ((subpath === '/' && method === 'DELETE') || (subpath === '/' && method === 'POST' && query.action === 'delete')) {
        const ok = scheduleStore.deleteSchedule(schId);
        scheduleStore.saveSchedules().catch(() => {});
        return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Schedule not found' });
      }

      if (subpath === '/pause' && method === 'POST') {
        const schedule = scheduleStore.togglePause(schId);
        if (!schedule) return send(res, 404, { error: 'Schedule not found' });
        scheduleStore.saveSchedules().catch(() => {});
        return send(res, 200, { schedule });
      }

      if (subpath === '/run' && method === 'POST') {
        const schedule = scheduleStore.scheduledTasks.get(schId);
        if (!schedule) return send(res, 404, { error: 'Schedule not found' });
        const cool = scheduleStore.checkManualCooldown(schId);
        if (cool.onCooldown) return send(res, 429, { error: 'cooldown', remainingMs: cool.remainingMs, remainingSec: cool.remainingSec, schedule });
        scheduleStore.recordManualRun(schId);
        const sessionId = runAgent({ prompt: schedule.prompt, res: null, asHtml: true, spaceName: null, sessionLabel: null, interactive: config.INTERACTIVE_MODE, currentUrl: null, config, allowTools: schedule.allowTools, source: 'schedule', runtime: schedule.runtime || config.RUNTIME });
        schedule.currentRunSessionId = sessionId;
        schedule.runCount++;
        scheduleStore.saveSchedules().catch(() => {});
        return send(res, 200, { triggered: true, schedule, sessionId });
      }
    }

    // ── 404 ───────────────────────────────────────────────────────────────
    send(res, 404, { error: 'Not found' });
  };
}

module.exports = { createRouter };
