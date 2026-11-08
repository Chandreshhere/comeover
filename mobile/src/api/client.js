// REST client for the Project IRL API (Node + MongoDB, base path /v1).
// - API access token (JWT) as Bearer; one transparent refresh + retry on 401.
// - Idempotency-Key on every mutating request (join, expense, payments).
// - Typed ApiError with server `code` so screens can branch on it.
import config, { isConfigured } from '@/config';
import { clearSession, getAccessToken, notifySignedOut } from './session';

export class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code || (status === 0 ? 'network' : `http_${status}`);
    this.data = data;
  }
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// The UI refers to the signed-in user as 'me'. Incoming payloads have the
// user's real id rewritten to 'me' (exact UUID match, so free text is safe);
// outgoing bodies map 'me' back, but only in id-typed fields.
let selfId = null;
export const setSelfId = (id) => {
  selfId = id || null;
};
const ID_KEY = /(^id$|Id$|Ids$|^userIds?$|^participants$|^memberIds$|^memberSeeds$)/;
function mapIncoming(v) {
  if (!selfId || v == null) return v;
  if (typeof v === 'string') return v === selfId ? 'me' : v;
  if (Array.isArray(v)) return v.map(mapIncoming);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = mapIncoming(v[k]);
    return out;
  }
  return v;
}
function mapOutgoing(v, key) {
  if (!selfId || v == null) return v;
  if (typeof v === 'string') return v === 'me' && key && ID_KEY.test(key) ? selfId : v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? mapOutgoing(x) : mapOutgoing(x, key)));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = mapOutgoing(v[k], k);
    return out;
  }
  return v;
}

export const qs = (params = {}) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

async function send(method, path, body, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${config.API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new ApiError(0, e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? 'The server took too long to respond.' : 'No connection.');
  } finally {
    clearTimeout(timer);
  }
}

export async function request(method, path, body, { idempotencyKey, auth = true } = {}) {
  if (!isConfigured()) throw new ApiError(0, 'not_configured', 'The app is not connected to a server yet.');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') headers['Idempotency-Key'] = idempotencyKey || uuid();

  const withAuth = async (force) => {
    if (!auth) return headers;
    const token = await getAccessToken({ force });
    return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
  };

  const outBody = body === undefined ? undefined : mapOutgoing(body);
  let res = await send(method, path, outBody, await withAuth(false));
  if (res.status === 401 && auth) {
    res = await send(method, path, outBody, await withAuth(true));
    if (res.status === 401) {
      await clearSession({ remote: false });
      notifySignedOut('unauthorized');
    }
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { message: text };
  }
  if (!res.ok) throw new ApiError(res.status, data?.code, data?.message, data);
  return mapIncoming(data);
}

export { mapIncoming };

export const api = {
  get: (p, params) => request('GET', `${p}${qs(params)}`),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  put: (p, b, o) => request('PUT', p, b ?? {}, o),
  patch: (p, b, o) => request('PATCH', p, b ?? {}, o),
  del: (p, o) => request('DELETE', p, undefined, o),
};

export default api;
