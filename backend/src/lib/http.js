'use strict';
// HTTP helpers shared by every handler module. The handler convention is the
// same as the legacy Lambda code so handlers port mechanically:
//
//   module.exports.routes = { 'GET /v1/things/{id}': async (req) => result }
//
// `req` = { params, query, headers, ip, requestId, body, rawBody(), user, authClaims, method, path }
//   - return a plain value      → 200 JSON
//   - return json(status, body) → passed through ({ statusCode, body, headers })
//   - throw err.*               → mapped JSON error { code, message, details? }
const config = require('../config');
const logger = require('../logger');

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const err = {
  badRequest: (code = 'bad_request', message, details) => new HttpError(400, code, message, details),
  unauthorized: (code = 'unauthorized', message) => new HttpError(401, code, message),
  forbidden: (code = 'forbidden', message) => new HttpError(403, code, message),
  notFound: (code = 'not_found', message) => new HttpError(404, code, message),
  conflict: (code = 'conflict', message, details) => new HttpError(409, code, message, details),
  unprocessable: (code = 'unprocessable', message, details) => new HttpError(422, code, message, details),
  tooMany: (retryAfterSec = 60, code = 'rate_limited', message = 'Too many requests. Try again shortly.') => {
    const e = new HttpError(429, code, message, { retryAfterSec });
    e.retryAfterSec = retryAfterSec;
    return e;
  },
  unavailable: (code = 'unavailable', message) => new HttpError(503, code, message),
};

const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(statusCode, body, headers) {
  return { statusCode, headers: { ...BASE_HEADERS, ...(headers || {}) }, body: body === undefined ? '' : JSON.stringify(body) };
}
const ok = (body) => json(200, body);
const created = (body) => json(201, body);
const noContent = () => ({ statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' });

function header(req, name) {
  const h = (req && req.headers) || {};
  const want = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return h[k];
  return undefined;
}

const isTransient = (e) => !!(e && (e.hasErrorLabel?.('TransientTransactionError') || (Array.isArray(e.errorLabels) && e.errorLabels.includes('TransientTransactionError')) || e.code === 112));

// Map our errors, Mongo/Mongoose errors and unknown errors to safe API responses.
function mapError(e, ctx = {}) {
  if (e instanceof HttpError) {
    const headers = e.retryAfterSec ? { 'retry-after': String(e.retryAfterSec) } : undefined;
    return json(e.status, { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }, headers);
  }
  if (e && (e.code === 11000 || e.code === 11001)) return json(409, { code: 'conflict', message: 'That already exists.' });
  if (e && (e.name === 'CastError' || e.name === 'ValidationError' || e.name === 'StrictModeError')) {
    return json(400, { code: 'invalid_value', message: 'One of the values is not allowed.' });
  }
  if (isTransient(e) || (e && e.code === 251)) return json(409, { code: 'retry', message: 'Please retry.' });
  logger.error({ msg: 'unhandled', route: ctx.route, err: e && e.message, stack: e && e.stack });
  return json(500, { code: 'internal', message: 'Something went wrong.' });
}

// "GET /v1/activities/{activityId}" → { method, expressPath: '/v1/activities/:activityId' }
function compileRouteKey(routeKey) {
  const [method, path] = routeKey.split(' ');
  if (!method || !path) throw new Error(`bad route key "${routeKey}"`);
  return { method: method.toUpperCase(), expressPath: path.replace(/\{(\w+)\}/g, ':$1') };
}

const MAINTENANCE_EXEMPT = /^\/v1\/(admin|webhooks|auth)\//;

function buildReq(r) {
  return {
    method: r.method,
    path: r.path,
    params: { ...r.params },
    query: r.query || {},
    headers: r.headers || {},
    ip: r.ip || null,
    requestId: r.id || null,
    body: r.body && typeof r.body === 'object' && !Buffer.isBuffer(r.body) ? r.body : {},
    rawBody: () => (r.rawBody ? r.rawBody.toString('utf8') : ''),
    user: null, // set by requireUser()
    authClaims: r.authClaims || null, // verified access-token claims (set by app middleware) or null
    authError: r.authError || null, // 401 to throw when a bearer token was sent but is invalid/expired
    routeKey: null,
  };
}

function send(res, out) {
  if (out && typeof out.statusCode === 'number') {
    res.status(out.statusCode);
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    return res.send(out.body == null ? '' : out.body);
  }
  return res.status(200).set(BASE_HEADERS).send(JSON.stringify(out === undefined ? { ok: true } : out));
}

// Mount a handler module's `routes` map on an Express app/router.
function mountRoutes(app, routes) {
  for (const [routeKey, fn] of Object.entries(routes || {})) {
    const { method, expressPath } = compileRouteKey(routeKey);
    const m = method.toLowerCase();
    if (typeof app[m] !== 'function') throw new Error(`unsupported method in "${routeKey}"`);
    app[m](expressPath, async (r, res) => {
      if (config.maintenance.enabled && !MAINTENANCE_EXEMPT.test(r.path)) {
        return send(res, json(503, { code: 'maintenance', message: config.maintenance.message }, { 'retry-after': '300' }));
      }
      const req = buildReq(r);
      req.routeKey = routeKey;
      try {
        const out = await fn(req);
        return send(res, out);
      } catch (e) {
        return send(res, mapError(e, { route: routeKey }));
      }
    });
  }
  return Object.keys(routes || {});
}

module.exports = { HttpError, err, json, ok, created, noContent, header, mapError, compileRouteKey, mountRoutes, buildReq, BASE_HEADERS };
