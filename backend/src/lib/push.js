'use strict';
// Push delivery via FCM HTTP v1 (Android directly, iOS through FCM→APNs).
// Respects per-category preferences, quiet hours and marketing consent.
const { getAccessToken, projectId } = require('./googleAuth');

const CATEGORY_PREF = {
  join: 'join_requests',
  message: 'messages',
  activity: 'nearby_activities',
  quest: 'quest_reminders',
  marketing: 'product_updates',
  safety: null, // safety notices are always delivered
  system: null,
};

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
}

// Pure: is `now` inside [start, end) in the given UTC offset (IST default)? Handles overnight windows.
function isQuietHours(now, start, end, offsetMin = 330) {
  if (!start || !end || start === end) return false;
  const local = new Date(now.getTime() + offsetMin * 60000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s < e ? mins >= s && mins < e : mins >= s || mins < e;
}

function shouldDeliver(prefs, type, now = new Date()) {
  if (!prefs) return type !== 'marketing';
  const key = CATEGORY_PREF[type];
  if (key && prefs[key] === false) return false;
  if (type === 'marketing' && !prefs.product_updates) return false;
  if (type === 'safety') return true;
  const q = prefs.quiet_hours || {};
  return !isQuietHours(now, q.start, q.end);
}

async function sendToTokens(tokens, notification) {
  if (!tokens.length) return { sent: 0 };
  const token = await getAccessToken('https://www.googleapis.com/auth/firebase.messaging').catch(() => null);
  const project = await projectId();
  if (!token || !project) {
    // TODO(credentials): configure FCM service account to enable push.
    console.log(JSON.stringify({ level: 'warn', msg: 'push_not_configured', count: tokens.length }));
    return { sent: 0, skipped: 'not_configured' };
  }
  let sent = 0;
  const invalid = [];
  for (const t of tokens) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: t,
          notification: { title: notification.title, body: notification.body || '' },
          data: Object.fromEntries(Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)])),
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.ok) sent += 1;
    else if (res.status === 404 || res.status === 400) invalid.push(t);
  }
  return { sent, invalid };
}

module.exports = { isQuietHours, shouldDeliver, sendToTokens, CATEGORY_PREF };
