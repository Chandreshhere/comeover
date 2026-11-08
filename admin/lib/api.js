// Admin API client for the real backend (NEXT_PUBLIC_API_URL already ends in /v1).
// - Authorization: Bearer <Cognito access token>, refreshed automatically.
// - Errors are JSON { code, message, details? } -> thrown as ApiError.
// - Lists use cursor pagination: { items, nextCursor }.
// - Mutations send an Idempotency-Key (reused on the post-refresh retry).
import { config } from './config';
import { clearTokens, getAccessToken, notifyUnauthorized, refreshTokens } from './auth';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code || 'Request failed');
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const enc = encodeURIComponent;

function newKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request(method, path, { query, body } = {}) {
  if (!config.apiUrl) throw new ApiError(0, 'not_configured', 'NEXT_PUBLIC_API_URL is not set.');
  const url = new URL(`${config.apiUrl}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const idempotencyKey = method === 'GET' ? null : newKey();

  const send = (token) =>
    fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

  const token = await getAccessToken();
  if (!token) {
    notifyUnauthorized();
    throw new ApiError(401, 'unauthenticated', 'Your session has ended. Sign in again.');
  }

  let res;
  try {
    res = await send(token);
    if (res.status === 401) {
      const fresh = await refreshTokens();
      if (fresh) res = await send(fresh);
    }
  } catch (e) {
    throw new ApiError(0, 'network', 'Could not reach the API. Check the network, NEXT_PUBLIC_API_URL and the API’s CORS settings.');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    if (res.status === 401) {
      clearTokens();
      notifyUnauthorized();
    }
    throw new ApiError(res.status, data?.code || `http_${res.status}`, data?.message || res.statusText || 'Request failed', data?.details);
  }
  return data;
}

const get = (p, query) => request('GET', p, { query });
const post = (p, body) => request('POST', p, { body: body || {} });
const patch = (p, body) => request('PATCH', p, { body: body || {} });

export const api = {
  // dashboard
  kpis: (range = '7d') => get('/admin/kpis', { range }),

  // reports
  reports: ({ status, cursor } = {}) => get('/admin/reports', { status, cursor }),
  report: (id) => get(`/admin/reports/${enc(id)}`),
  reportAction: (id, { action, reason, durationDays }) =>
    post(`/admin/reports/${enc(id)}/actions`, { action, reason, ...(durationDays ? { durationDays: Number(durationDays) } : {}) }),
  reportAppeal: (id, { decision, reason }) => post(`/admin/reports/${enc(id)}/appeal`, { decision, reason }),

  // users
  user: (id) => get(`/admin/users/${enc(id)}`),
  setUserStatus: (id, { status, reason }) => post(`/admin/users/${enc(id)}/status`, { status, reason }),

  // audit
  audit: ({ entityType, entityId, cursor } = {}) => get('/admin/audit', { entityType, entityId, cursor }),

  // activities
  activities: ({ queue = 'flagged', cursor } = {}) => get('/admin/activities', { queue, cursor }),
  activityDecision: (id, { decision, reason }) => post(`/admin/activities/${enc(id)}/decision`, { decision, reason }),

  // billing (read-only; no card data)
  subscriptions: ({ q } = {}) => get('/admin/billing/subscriptions', { q }),
  campaigns: () => get('/admin/billing/campaigns'),

  // taxonomy
  categories: () => get('/admin/taxonomy/categories'),
  createCategory: (body) => post('/admin/taxonomy/categories', body),
  updateCategory: (slug, body) => patch(`/admin/taxonomy/categories/${enc(slug)}`, body),
  areas: () => get('/admin/taxonomy/areas'),
  createArea: (body) => post('/admin/taxonomy/areas', body),
  updateArea: (id, body) => patch(`/admin/taxonomy/areas/${enc(id)}`, body),
  quests: () => get('/admin/taxonomy/quests'),
  createQuest: (body) => post('/admin/taxonomy/quests', body),
  updateQuest: (id, body) => patch(`/admin/taxonomy/quests/${enc(id)}`, body),
};

export default api;
