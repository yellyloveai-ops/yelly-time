'use strict';
// schedule-store.js — Schedule CRUD, YAML git persistence, tick logic

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
/** @type {Map<string, object>} */
const scheduledTasks = new Map();

/** @type {Map<string, number>} cooldown: scheduleId → last manual run timestamp */
const scheduleCooldowns = new Map();

let _scheduleRepo  = null;  // git repo root path
let _alias         = 'user';
let _scheduleCounter = 0;

const MANUAL_COOLDOWN_MS = 60_000;

const SCHEDULE_PERSIST_KEYS = [
  'id', 'name', 'prompt', 'interval', 'enabled',
  'createdAt', 'nextRunAt', 'allowTools', 'runLate', 'runtime',
];

const VALID_INTERVALS = ['30m', '1h', '6h', '12h', '1d', '1w', 'once'];

const INTERVAL_MS = {
  '30m':  1_800_000,
  '1h':   3_600_000,
  '6h':  21_600_000,
  '12h': 43_200_000,
  '1d':  86_400_000,
  '1w': 604_800_000,
  'once': null,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function setScheduleRepo(repoPath) { _scheduleRepo = repoPath; }
function setAlias(alias)           { _alias = alias; }

function getScheduleFilePath() {
  if (!_scheduleRepo) return null;
  return path.join(_scheduleRepo, 'schedules', `${_alias}.yaml`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
function createSchedule({ name, prompt, interval, allowTools = false, nextRunAt, runLate, runtime }) {
  if (!name || !prompt || !interval) throw new Error('name, prompt, interval are required');
  if (!VALID_INTERVALS.includes(interval)) throw new Error(`Invalid interval: ${interval}`);
  if (interval === 'once' && !nextRunAt)   throw new Error('nextRunAt is required for once schedules');

  const id = `sched_${++_scheduleCounter}`;
  const now = Date.now();
  const nextRunMs = nextRunAt ? new Date(nextRunAt).getTime() : now + 60_000;

  const schedule = {
    id,
    name,
    prompt,
    interval,
    enabled: true,
    createdAt: new Date().toISOString(),
    nextRunAt: nextRunMs,
    allowTools,
    runLate: interval === 'once' ? (runLate || false) : undefined,
    runtime: runtime || null,
    // runtime-only
    intervalMs: INTERVAL_MS[interval],
    lastRunAt: null,
    lastRunSessionId: null,
    currentRunSessionId: null,
    runCount: 0,
  };

  scheduledTasks.set(id, schedule);
  return schedule;
}

function updateSchedule(id, updates) {
  const schedule = scheduledTasks.get(id);
  if (!schedule) return null;
  const allowed = ['name', 'prompt', 'interval', 'allowTools', 'nextRunAt', 'runtime'];
  for (const key of allowed) {
    if (key in updates) {
      if (key === 'interval') {
        if (!VALID_INTERVALS.includes(updates.interval)) throw new Error(`Invalid interval: ${updates.interval}`);
        schedule.interval = updates.interval;
        schedule.intervalMs = INTERVAL_MS[updates.interval];
      } else if (key === 'nextRunAt') {
        schedule.nextRunAt = new Date(updates.nextRunAt).getTime();
      } else {
        schedule[key] = updates[key];
      }
    }
  }
  return schedule;
}

function deleteSchedule(id) {
  return scheduledTasks.delete(id);
}

function togglePause(id) {
  const schedule = scheduledTasks.get(id);
  if (!schedule) return null;
  schedule.enabled = !schedule.enabled;
  if (schedule.enabled && schedule.interval !== 'once') {
    schedule.nextRunAt = Date.now() + 60_000;
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// Manual run cooldown
// ---------------------------------------------------------------------------
function checkManualCooldown(id) {
  const last = scheduleCooldowns.get(id) || 0;
  const remaining = MANUAL_COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) {
    return { onCooldown: true, remainingMs: remaining, remainingSec: Math.ceil(remaining / 1000) };
  }
  return { onCooldown: false };
}

function recordManualRun(id) {
  scheduleCooldowns.set(id, Date.now());
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
/**
 * Called every 30 seconds. Fires due schedules.
 * @param {function(string, object): number} runAgentFn  runAgent(prompt, scheduleObj) → sessionId
 */
function scheduleTick(runAgentFn) {
  const now = Date.now();
  for (const [id, schedule] of scheduledTasks) {
    if (!schedule.enabled) continue;
    if (schedule.nextRunAt > now) continue;

    let sessionId;
    try {
      sessionId = runAgentFn(schedule.prompt, schedule);
    } catch (err) {
      console.error(`[scheduler] Failed to run schedule ${id}: ${err.message}`);
      continue;
    }

    schedule.lastRunAt = now;
    schedule.currentRunSessionId = sessionId;
    schedule.runCount++;

    if (schedule.interval === 'once') {
      schedule.enabled   = false;
      schedule.nextRunAt = Infinity;
    } else {
      schedule.nextRunAt = now + schedule.intervalMs;
    }

    saveSchedules().catch(err => console.warn(`[scheduler] Save failed: ${err.message}`));
  }
}

/**
 * Call when a session closes. Updates schedule's currentRunSessionId → lastRunSessionId.
 * @param {number} sessionId
 */
function onSessionClose(sessionId) {
  for (const schedule of scheduledTasks.values()) {
    if (schedule.currentRunSessionId === sessionId) {
      schedule.lastRunSessionId    = sessionId;
      schedule.currentRunSessionId = null;
      saveSchedules().catch(() => {});
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// YAML serialization (no external deps)
// ---------------------------------------------------------------------------
function serializeSchedules() {
  const lines = [];
  for (const schedule of scheduledTasks.values()) {
    lines.push('-');
    for (const key of SCHEDULE_PERSIST_KEYS) {
      let val = schedule[key];
      if (val === undefined) continue;
      // nextRunAt: store as ISO string
      if (key === 'nextRunAt' && typeof val === 'number' && isFinite(val)) {
        val = new Date(val).toISOString();
      }
      if (val === null)         { lines.push(`  ${key}: null`); continue; }
      if (typeof val === 'boolean') { lines.push(`  ${key}: ${val}`); continue; }
      if (typeof val === 'number')  { lines.push(`  ${key}: ${val}`); continue; }
      // string — quote if contains special chars
      lines.push(`  ${key}: "${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
  }
  return lines.join('\n') + '\n';
}

function parseScheduleYaml(yaml) {
  const schedules = [];
  // Split on lines starting with "- " or "-\n"
  const blocks = yaml.split(/^- /m).filter(b => b.trim());
  for (const block of blocks) {
    const obj = {};
    for (const line of block.split('\n')) {
      const m = line.match(/^\s{0,2}(\w+):\s*(.*)/);
      if (!m) continue;
      const [, key, raw] = m;
      let val = raw.trim();
      if (val === 'null')        { obj[key] = null; continue; }
      if (val === 'true')        { obj[key] = true; continue; }
      if (val === 'false')       { obj[key] = false; continue; }
      if (/^-?\d+$/.test(val))  { obj[key] = parseInt(val, 10); continue; }
      // unquote
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      obj[key] = val;
    }
    if (obj.id) schedules.push(obj);
  }
  return schedules;
}

function restoreNextRunAt(schedule) {
  const now = Date.now();
  let ms;
  if (schedule.nextRunAt && schedule.nextRunAt !== 'null') {
    ms = typeof schedule.nextRunAt === 'number' ? schedule.nextRunAt : new Date(schedule.nextRunAt).getTime();
  }

  if (schedule.interval === 'once') {
    if (ms && ms > now) {
      schedule.nextRunAt = ms;
    } else if (ms && ms <= now && schedule.runLate) {
      schedule.nextRunAt = now; // fire immediately
    } else {
      schedule.enabled   = false;
      schedule.nextRunAt = Infinity;
    }
  } else {
    // recurring
    if (ms && ms > now) {
      schedule.nextRunAt = ms;
    } else {
      schedule.nextRunAt = now + 60_000;
    }
  }
}

// ---------------------------------------------------------------------------
// Git-backed persistence
// ---------------------------------------------------------------------------
async function saveSchedules() {
  const file = getScheduleFilePath();
  if (!file) return; // in-memory only

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  try {
    execSync('git pull --rebase', { cwd: _scheduleRepo, stdio: 'pipe' });
  } catch (err) {
    console.warn(`[scheduler] git pull failed: ${err.message}`);
  }

  fs.writeFileSync(file, serializeSchedules(), 'utf8');

  try {
    execSync(`git add "${file}"`, { cwd: _scheduleRepo, stdio: 'pipe' });
    execSync(`git commit -m "yellytime: update schedules for ${_alias}"`, { cwd: _scheduleRepo, stdio: 'pipe' });
    execSync('git push', { cwd: _scheduleRepo, stdio: 'pipe' });
  } catch (err) {
    console.warn(`[scheduler] git push failed: ${err.message}`);
  }
}

async function loadSchedules() {
  const file = getScheduleFilePath();
  if (!file || !fs.existsSync(file)) return;

  try {
    execSync('git pull --rebase', { cwd: _scheduleRepo, stdio: 'pipe' });
  } catch (err) {
    console.warn(`[scheduler] git pull on load failed: ${err.message}`);
  }

  let yaml;
  try {
    yaml = fs.readFileSync(file, 'utf8');
  } catch { return; }

  const parsed = parseScheduleYaml(yaml);
  for (const raw of parsed) {
    // Restore interval counter
    const numId = parseInt(raw.id.replace('sched_', ''), 10);
    if (numId > _scheduleCounter) _scheduleCounter = numId;

    restoreNextRunAt(raw);
    raw.intervalMs           = INTERVAL_MS[raw.interval] || null;
    raw.lastRunAt            = null;
    raw.lastRunSessionId     = null;
    raw.currentRunSessionId  = null;
    raw.runCount             = 0;

    scheduledTasks.set(raw.id, raw);
  }

  console.log(`[scheduler] Loaded ${scheduledTasks.size} schedule(s) for alias "${_alias}"`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  scheduledTasks,
  scheduleCooldowns,
  setScheduleRepo,
  setAlias,
  getScheduleFilePath,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  togglePause,
  checkManualCooldown,
  recordManualRun,
  scheduleTick,
  onSessionClose,
  saveSchedules,
  loadSchedules,
  VALID_INTERVALS,
  INTERVAL_MS,
};
