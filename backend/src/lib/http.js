'use strict';
// HTTP helpers for API Gateway HTTP API (payload v2) Lambda proxies:
// errors, JSON responses, body parsing and a tiny routeKey router.

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
  return {
    statusCode,
    headers: { ...BASE_HEADERS, ...(headers || {}) },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}
const ok = (body) => json(200, body);
const created = (body) => json(201, body);
const noContent = () => ({ statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' });

function rawBody(event) {
  if (!event || event.body == null) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : String(event.body);
}

function parseBody(event) {
  const raw = rawBody(event);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch (e) {
    throw err.badRequest('invalid_json', 'Request body must be a JSON object');
  }
}

function header(event, name) {
  const h = (event && event.headers) || {};
  const want = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return h[k];
  return undefined;
}

// Map Postgres and unknown errors to safe API responses.
function mapError(e, event) {
  if (e instanceof HttpError) {
    const headers = e.retryAfterSec ? { 'retry-after': String(e.retryAfterSec) } : undefined;
    return json(e.status, { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }, headers);
  }
  switch (e && e.code) {
    case '23505':
      return json(409, { code: 'conflict', message: 'That already exists.' });
    case '23503':
      return json(409, { code: 'reference_conflict', message: 'A referenced record does not exist.' });
    case '23514':
    case '22P02':
    case '22007':
    case '22003':
      return json(400, { code: 'invalid_value', message: 'One of the values is not allowed.' });
    case '40001':
    case '40P01':
      return json(409, { code: 'retry', message: 'Please retry.' });
    default:
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ level: 'error', msg: 'unhandled', routeKey: event && event.routeKey, error: e && e.message, stack: e && e.stack }));
      return json(500, { code: 'internal', message: 'Something went wrong.' });
  }
}

function compile(routeKey) {
  const [method, path] = routeKey.split(' ');
  const names = [];
  const re = new RegExp(
    '^' +
      path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, n) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '/?$'
  );
  return { method, re, names };
}

// Router keyed by API Gateway routeKey ("GET /v1/activities/{activityId}").
// Falls back to method+path matching so handlers also work in local tests.
function createRouter(routes) {
  const compiled = Object.entries(routes).map(([key, fn]) => ({ key, fn, ...compile(key) }));
  const handler = async (event, context) => {
    if (context) context.callbackWaitsForEmptyEventLoop = false;
    let entry = compiled.find((r) => r.key === event.routeKey);
    let params = { ...(event.pathParameters || {}) };
    if (!entry) {
      const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod;
      const path = event.rawPath || event.path || '';
      for (const r of compiled) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (m) {
          entry = r;
          r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
          break;
        }
      }
    }
    if (!entry) return json(404, { code: 'route_not_found' });
    // Global maintenance switch (Lambda env MAINTENANCE_MODE=true). Admin and webhooks stay up.
    if (process.env.MAINTENANCE_MODE === 'true' && !/ \/v1\/(admin|webhooks)\//.test(entry.key)) {
      return json(503, { code: 'maintenance', message: process.env.MAINTENANCE_MESSAGE || "We're doing a quick tune-up. Back shortly." }, { 'retry-after': '300' });
    }
    let bodyCache;
    const req = {
      event,
      params,
      query: event.queryStringParameters || {},
      headers: event.headers || {},
      ip: (event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp) || null,
      requestId: (event.requestContext && event.requestContext.requestId) || null,
      get body() {
        if (bodyCache === undefined) bodyCache = parseBody(event);
        return bodyCache;
      },
      rawBody: () => rawBody(event),
    };
    try {
      const res = await entry.fn(req);
      if (res && typeof res.statusCode === 'number') return res;
      return ok(res === undefined ? { ok: true } : res);
    } catch (e) {
      return mapError(e, event);
    }
  };
  handler.routes = Object.keys(routes);
  return handler;
}

module.exports = { HttpError, err, json, ok, created, noContent, parseBody, rawBody, header, mapError, createRouter };
