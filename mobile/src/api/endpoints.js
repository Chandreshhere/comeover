// Every backend call the app makes, grouped by resource. Mirrors
// 08_api_contract.json + the additions documented in backend/docs/API.md.
import api from './client';

const enc = encodeURIComponent;

// Cities and their areas (city/area picker, nearest-city match).
export const cities = {
  list: () => api.get('/cities'),
};

export const me = {
  bootstrap: () => api.get('/me/bootstrap'),
  get: () => api.get('/me'),
  update: (patch) => api.patch('/me', patch),
  updatePreferences: (patch) => api.patch('/me/preferences', patch),
  setAvailability: (body) => api.put('/me/availability', body),
  progress: () => api.get('/me/progress'),
  roadmap: () => api.get('/me/roadmap'),
  milestones: () => api.get('/me/milestones'),
  achievements: () => api.get('/me/achievements'),
  streakCalendar: (months = 3) => api.get('/me/streak-calendar', { months }),
  streakFreeze: () => api.post('/me/streak-freeze'),
  activities: (tab) => api.get('/me/activities', { tab }),
  subscription: () => api.get('/me/subscription'),
  reports: () => api.get('/me/reports'),
  blocks: () => api.get('/me/blocks'),
  remove: () => api.del('/me'),
  requestDataExport: () => api.post('/me/data-export'),
};

export const users = {
  publicProfile: (userId) => api.get(`/users/${enc(userId)}/public-profile`),
};

export const discovery = {
  categories: () => api.get('/activities/categories'),
  activities: (params) => api.get('/activities', params),
  featured: (params) => api.get('/activities/featured', params),
  activity: (id) => api.get(`/activities/${enc(id)}`),
  nearbyPeople: (params) => api.get('/availability/nearby', params),
  search: (q, params) => api.get('/search', { q, ...params }),
};

export const activities = {
  create: (body, key) => api.post('/activities', body, { idempotencyKey: key }),
  update: (id, patch) => api.patch(`/activities/${enc(id)}`, patch),
  cancel: (id, reason) => api.post(`/activities/${enc(id)}/cancel`, { reason }),
  requestJoin: (id, intro) => api.post(`/activities/${enc(id)}/join-requests`, { intro }, { idempotencyKey: `join:${id}` }),
  cancelJoin: (id) => api.del(`/activities/${enc(id)}/join-requests/me`),
  joinRequests: (id) => api.get(`/activities/${enc(id)}/join-requests`),
  acceptJoin: (id, requestId) => api.post(`/activities/${enc(id)}/join-requests/${enc(requestId)}/accept`),
  declineJoin: (id, requestId) => api.post(`/activities/${enc(id)}/join-requests/${enc(requestId)}/decline`),
  checkIn: (id, body) => api.post(`/activities/${enc(id)}/check-ins`, body, { idempotencyKey: `checkin:${id}` }),
  confirmCompletion: (id) => api.post(`/activities/${enc(id)}/completion-confirmations`, {}, { idempotencyKey: `complete:${id}` }),
  feedback: (id, body) => api.post(`/activities/${enc(id)}/feedback`, body, { idempotencyKey: `feedback:${id}` }),
};

export const messaging = {
  conversations: () => api.get('/conversations'),
  start: (body) => api.post('/conversations', body),
  messages: (id, params) => api.get(`/conversations/${enc(id)}/messages`, params),
  send: (id, body, key) => api.post(`/conversations/${enc(id)}/messages`, { body }, { idempotencyKey: key }),
  read: (id) => api.post(`/conversations/${enc(id)}/read`),
  mute: (id, muted) => api.post(`/conversations/${enc(id)}/mute`, { muted }),
  remove: (id) => api.del(`/conversations/${enc(id)}`),
  reportMessage: (messageId, body) => api.post(`/messages/${enc(messageId)}/report`, body),
};

export const circles = {
  list: (params) => api.get('/circles', params),
  create: (body) => api.post('/circles', body),
  get: (id) => api.get(`/circles/${enc(id)}`),
  members: (id) => api.get(`/circles/${enc(id)}/members`),
  join: (id) => api.post(`/circles/${enc(id)}/members`),
  leave: (id) => api.del(`/circles/${enc(id)}/members/me`),
  removeMember: (id, userId) => api.del(`/circles/${enc(id)}/members/${enc(userId)}`),
  createPlan: (id, body) => api.post(`/circles/${enc(id)}/plans`, body),
  challenge: (id) => api.get(`/circles/${enc(id)}/challenge`),
  joinChallenge: (id) => api.post(`/circles/${enc(id)}/challenge/join`),
};

export const quests = {
  today: () => api.get('/quests/today'),
  list: (kind) => api.get('/quests', { kind }),
  start: (id) => api.post(`/quests/${enc(id)}/start`),
  claim: (id) => api.post(`/quests/${enc(id)}/claim`, {}, { idempotencyKey: `claim:${id}` }),
};

export const expenses = {
  list: () => api.get('/expenses'),
  get: (id) => api.get(`/expenses/${enc(id)}`),
  create: (body, key) => api.post('/expenses', body, { idempotencyKey: key }),
  addItems: (id, items) => api.post(`/expenses/${enc(id)}/items`, { items }),
  addParticipants: (id, userIds) => api.post(`/expenses/${enc(id)}/participants`, { userIds }),
  summary: (id) => api.get(`/expenses/${enc(id)}/summary`),
  updateShare: (id, userId, body) => api.patch(`/expenses/${enc(id)}/shares/${enc(userId)}`, body),
  settlementIntent: (id, body) => api.post(`/expenses/${enc(id)}/settlement-intent`, body),
  settlementConfirmation: (id, body) => api.post(`/expenses/${enc(id)}/settlement-confirmation`, body),
};

export const safety = {
  report: (body) => api.post('/reports', body),
  block: (userId) => api.post('/blocks', { userId }),
  unblock: (userId) => api.del(`/blocks/${enc(userId)}`),
  trustedContacts: () => api.get('/trusted-contacts'),
  inviteTrustedContact: (body) => api.post('/trusted-contacts/invitations', body),
  removeTrustedContact: (id) => api.del(`/trusted-contacts/${enc(id)}`),
  caseStatus: () => api.get('/safety/case-status'),
};

export const notifications = {
  list: (params) => api.get('/notifications', params),
  read: (id) => api.post(`/notifications/${enc(id)}/read`),
  readAll: () => api.post('/notifications/read-all'),
  registerDevice: (platform, token) => api.post('/devices', { platform, token }),
  unregisterDevice: (token) => api.del(`/devices/${enc(token)}`),
};

export const media = {
  uploadUrl: (body) => api.post('/media/upload-url', body),
};

export const monetization = {
  plans: () => api.get('/plans'),
  verifyReceipt: (body) => api.post('/subscriptions/receipt/verify', body, { idempotencyKey: `iap:${body.transactionId || body.purchaseToken}` }),
  restore: (body) => api.post('/subscriptions/restore', body),
};

export const business = {
  venues: (params) => api.get('/venues', params),
  venue: (id) => api.get(`/venues/${enc(id)}`),
  myVenue: () => api.get('/business/venues/me'),
  onboard: (body) => api.post('/business/venues', body),
  campaigns: () => api.get('/business/campaigns'),
  createCampaign: (body) => api.post('/business/campaigns', body),
  analytics: (params) => api.get('/business/analytics', params),
  createPaymentOrder: (body) => api.post('/business/payments/order', body),
  // Partner perks (staff of the venue's business).
  offers: () => api.get('/business/offers'),
  createOffer: (body) => api.post('/business/offers', body),
  updateOffer: (id, patch) => api.patch(`/business/offers/${enc(id)}`, patch),
  confirmRedemption: (body) => api.post('/business/redemptions/confirm', body),
  redemptions: () => api.get('/business/redemptions'),
  tableHolds: (params) => api.get('/business/table-holds', params),
  respondTableHold: (id, body) => api.post(`/business/table-holds/${enc(id)}/respond`, body),
};

// Partner perks for app users: unlocked by level, never paid for with XP.
export const perks = {
  mine: (params) => api.get('/me/perks', params),
  redeem: (offerId, body) => api.post(`/offers/${enc(offerId)}/redeem`, body),
  redemption: (id) => api.get(`/redemptions/${enc(id)}`),
  cancelRedemption: (id) => api.post(`/redemptions/${enc(id)}/cancel`),
  myRedemptions: () => api.get('/me/redemptions'),
};

// Host asks a partner venue to hold a table for a plan (no money involved).
export const tableHolds = {
  get: (activityId) => api.get(`/activities/${enc(activityId)}/table-hold`),
  request: (activityId, body) => api.post(`/activities/${enc(activityId)}/table-hold`, body, { idempotencyKey: `hold:${activityId}` }),
  cancel: (activityId) => api.del(`/activities/${enc(activityId)}/table-hold`),
};

export const assistant = {
  suggest: (body) => api.post('/assistant/suggest', body),
};
