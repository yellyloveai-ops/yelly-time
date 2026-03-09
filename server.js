'use strict';
// server.js — Entry point: config, security state, startup, timers
// Usage: node yelly-time/server.js [options]

const http         = require('http');
const crypto       = require('crypto');
const os           = require('os');
const fs           = require('fs');
const path         = require('path');
const { execSync, spawnSync } = require('child_process');

const { createRouter }   = require('./routes');
const sessionStore       = require('./session-store');
const scheduleStore      = require('./schedule-store');
const { loadPreapprovalRules } = require('./preapproval');
const { warnIfMissingApiKey }  = require('./runtimes/gpt-codex');

// ---------------------------------------------------------------------------
// CLI + env parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : def; };
  const has  = flag => args.includes(flag);

  return {
    PORT:             parseInt(get('--port', process.env.YELLYTIME_PORT || '2026'), 10),
    RUNTIME:          get('--runtime',    process.env.YELLYTIME_RUNTIME    || 'codex-cli'),
    CODEX_CLI_BIN:    get('--codex',      process.env.YELLYTIME_CODEX_CLI_BIN || 'codex-cli'),
    CLAUDE_BIN:       get('--claude',     process.env.YELLYTIME_CLAUDE_BIN    || 'claude'),
    CODEX_BIN:        get('--codex-gpt',  process.env.YELLYTIME_CODEX_BIN     || 'codex'),
    MODEL:            get('--model',      process.env.YELLYTIME_MODEL          || null),
    INTERACTIVE_MODE: has('--interactive'),
    SCHEDULE_REPO:    get('--repo',       process.env.YELLYTIME_SCHEDULE_REPO  || null),
    ALIAS:            get('--alias',      process.env.YELLYTIME_ALIAS          || os.userInfo().username),
    SESSION_DIR:      get('--session-dir', process.env.YELLYTIME_SESSION_DIR   || path.join(os.homedir(), '.yelly-time', 'sessions')),
    TRUST_TOOLS:      get('--trust-tools', ''),
    REPO_ROOT:        path.resolve(__dirname, '..'),
  };
}

// ---------------------------------------------------------------------------
// Parse allowed domains from yelly-spark.user.js @match lines
// ---------------------------------------------------------------------------
function parseAllowedDomains(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'yelly-spark.user.js'),
    path.join(repoRoot, 'v1', 'run.js'),
  ];
  const domains = new Set(['localhost', '127.0.0.1']);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/@match\s+https?:\/\/([^/\s*]+)/);
        if (m) domains.add(m[1]);
      }
    } catch { /* ignore */ }
  }
  return [...domains];
}

// ---------------------------------------------------------------------------
// Probe runtime availability
// ---------------------------------------------------------------------------
function probeRuntime(name, bin) {
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 3000, encoding: 'utf8' });
    if (r.status === 0 || r.stdout) {
      return { available: true, bin, version: (r.stdout || r.stderr || '').trim().split('\n')[0] };
    }
    return { available: false, bin, error: r.stderr ? r.stderr.trim() : 'non-zero exit' };
  } catch (err) {
    return { available: false, bin, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Create working directory
// ---------------------------------------------------------------------------
function createWorkDir() {
  const now    = new Date();
  const stamp  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const dir    = path.join(os.tmpdir(), 'yelly-time', `yt-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Main startup
// ---------------------------------------------------------------------------
async function start() {
  const cfg = parseArgs();

  // 1. CSRF token
  const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');

  // 2. Allowed domains
  const ALLOWED_DOMAINS = parseAllowedDomains(cfg.REPO_ROOT);

  // 3. Working dir
  const WORK_DIR = createWorkDir();

  // 4. Preapproval rules
  loadPreapprovalRules(path.join(cfg.REPO_ROOT, 'v1', 'preapproval-rules.json'));

  // 5. Probe runtimes
  const runtimeAvailability = {
    'codex-cli':   probeRuntime('codex-cli',   cfg.CODEX_CLI_BIN),
    'claude-code': probeRuntime('claude-code',  cfg.CLAUDE_BIN),
    'gpt-codex':   probeRuntime('gpt-codex',    cfg.CODEX_BIN),
  };

  // Warn if active runtime unavailable
  if (!runtimeAvailability[cfg.RUNTIME]?.available) {
    console.warn(`[server] WARNING: Active runtime "${cfg.RUNTIME}" binary not found or unavailable.`);
  }
  if (cfg.RUNTIME === 'gpt-codex') warnIfMissingApiKey();

  // 6. Active bin for /health
  const activeBin = {
    'codex-cli':   cfg.CODEX_CLI_BIN,
    'claude-code': cfg.CLAUDE_BIN,
    'gpt-codex':   cfg.CODEX_BIN,
  }[cfg.RUNTIME];

  // 7. Session + schedule config
  sessionStore.setSessionDir(cfg.SESSION_DIR);
  if (cfg.SCHEDULE_REPO) {
    scheduleStore.setScheduleRepo(cfg.SCHEDULE_REPO);
    scheduleStore.setAlias(cfg.ALIAS);
  }

  // 8. Rate limit state
  const rateLimitCounters = new Map();

  // 9. Assemble config object
  const config = {
    ...cfg,
    CSRF_TOKEN,
    ALLOWED_DOMAINS,
    WORK_DIR,
    rateLimitCounters,
    runtimeAvailability,
    activeBin,
  };

  // 10. HTTP server
  const router = createRouter(config);
  const server = http.createServer(router);
  config.server = server;

  // 11. Timers
  setInterval(() => sessionStore.cleanupIdleSessions(), 60_000);
  setInterval(() => {
    scheduleStore.scheduleTick((prompt, schedule) =>
      require('./runtimes/index').runAgent({
        prompt,
        res: null,
        asHtml: true,
        spaceName: null,
        sessionLabel: null,
        interactive: cfg.INTERACTIVE_MODE,
        currentUrl: null,
        config,
        allowTools: schedule.allowTools || false,
        source: 'schedule',
        runtime: schedule.runtime || cfg.RUNTIME,
      })
    );
  }, 30_000);

  // 12. Load schedules
  if (cfg.SCHEDULE_REPO) {
    try { await scheduleStore.loadSchedules(); }
    catch (err) { console.warn(`[server] Failed to load schedules: ${err.message}`); }
  }

  // 13. Listen
  server.listen(cfg.PORT, '127.0.0.1', () => {
    console.log(`[YellyTime] Server running on http://127.0.0.1:${cfg.PORT}`);
    console.log(`[YellyTime] Runtime:    ${cfg.RUNTIME} (${activeBin})`);
    if (cfg.MODEL)  console.log(`[YellyTime] Model:      ${cfg.MODEL}`);
    console.log(`[YellyTime] Work dir:   ${WORK_DIR}`);
    console.log(`[YellyTime] Allowed:    ${ALLOWED_DOMAINS.join(', ')}`);
    if (cfg.SCHEDULE_REPO) console.log(`[YellyTime] Schedules:  ${scheduleStore.getScheduleFilePath()}`);
    console.log(`[YellyTime] Runtimes:`);
    for (const [name, info] of Object.entries(runtimeAvailability)) {
      const mark = info.available ? '✓' : '✗';
      console.log(`  ${mark} ${name}: ${info.bin}${info.version ? ' (' + info.version + ')' : ''}${info.error ? ' — ' + info.error : ''}`);
    }
    console.log('[YellyTime] Ready.');
  });

  server.on('error', err => {
    console.error(`[server] Fatal: ${err.message}`);
    process.exit(1);
  });
}

start().catch(err => {
  console.error('[server] Startup failed:', err);
  process.exit(1);
});
