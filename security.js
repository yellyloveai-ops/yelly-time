'use strict';
// security.js — CSRF token validation, rate limiting, host/origin checks
// All logic lives in server.js config; these are pure functions over that config.

/**
 * Validate Host header: must be localhost or 127.0.0.1 with optional :<PORT>
 * @param {string} host
 * @param {number} port
 * @returns {boolean}
 */
function isHostValid(host, port) {
  if (!host) return false;
  const allowed = [
    'localhost',
    `localhost:${port}`,
    '127.0.0.1',
    `127.0.0.1:${port}`,
  ];
  return allowed.includes(host.toLowerCase());
}

/**
 * Check if origin/referer is in the allowed domain list.
 * If no origin/referer header is present, allow the request.
 * @param {string|null} origin
 * @param {string[]} allowedDomains  e.g. ['localhost', '127.0.0.1', 'example.com']
 * @returns {boolean}
 */
function isOriginAllowed(origin, allowedDomains) {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Validate CSRF token on POST/DELETE requests.
 * @param {string} method
 * @param {string|undefined} headerToken
 * @param {string} serverToken
 * @returns {boolean}
 */
function isTokenValid(method, headerToken, serverToken) {
  const requiresToken = method === 'POST' || method === 'DELETE';
  if (!requiresToken) return true;
  return headerToken === serverToken;
}

/**
 * Rate limiter — 100 requests per 60-second window per origin key.
 * Mutates the counters map in place.
 * @param {string} key  origin header or host as fallback
 * @param {Map<string, {count: number, windowStart: number}>} counters
 * @returns {boolean}  true if allowed, false if limit exceeded
 */
function checkRateLimit(key, counters) {
  const WINDOW_MS = 60_000;
  const MAX = 100;
  const now = Date.now();
  let entry = counters.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    counters.set(key, entry);
    return true;
  }
  entry.count++;
  return entry.count <= MAX;
}

/**
 * Run the full security validation pipeline.
 * Returns null on success, or { status, message } on failure.
 * @param {{method:string, headers:object}} req
 * @param {number} port
 * @param {string[]} allowedDomains
 * @param {string} csrfToken
 * @param {Map} rateLimitCounters
 * @returns {{status:number, message:string}|null}
 */
function validateSecurity(req, port, allowedDomains, csrfToken, rateLimitCounters) {
  const host   = req.headers['host'] || '';
  const origin = req.headers['origin'] || req.headers['referer'] || null;
  const token  = req.headers['x-yellytime-token'];
  const key    = origin || host;

  if (!isHostValid(host, port))
    return { status: 403, message: 'Forbidden: invalid host' };

  if (!isOriginAllowed(origin, allowedDomains))
    return { status: 403, message: 'Forbidden: origin not allowed' };

  if (!isTokenValid(req.method, token, csrfToken))
    return { status: 403, message: 'Forbidden: invalid or missing CSRF token' };

  if (!checkRateLimit(key, rateLimitCounters))
    return { status: 429, message: 'Too Many Requests' };

  return null;
}

module.exports = { isHostValid, isOriginAllowed, isTokenValid, checkRateLimit, validateSecurity };
