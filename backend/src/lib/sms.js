'use strict';
// Transactional SMS via Slide (POST https://api.slide.cx/v1/sms/send, scope sms:send).
// Used for trusted-contact plan shares. India requires DLT registration: the sender
// ID and each message template must be approved in Slide (Dashboard → SMS), and the
// text sent must match the approved template exactly.
//
// Never throws: when SMS isn't configured or Slide fails, returns { sent: false, reason }
// and the caller still succeeds (the app also offers a native share sheet).
const config = require('../config');
const logger = require('../logger');

let fetchImpl = (...args) => fetch(...args);
const setFetch = (fn) => {
  fetchImpl = fn || ((...args) => fetch(...args));
};

const senderId = () => process.env.SLIDE_SMS_SENDER_ID || '';
const isConfigured = () => !!(config.slide.apiKey && senderId());

// templateKey: 'plan_share' | 'trusted_invite' → env SLIDE_SMS_TEMPLATE_<KEY> (DLT template id)
async function sendSms(to, message, { templateKey } = {}) {
  if (!isConfigured()) return { sent: false, reason: 'not_configured' };
  const templateId = templateKey ? process.env[`SLIDE_SMS_TEMPLATE_${templateKey.toUpperCase()}`] || undefined : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.slide.timeoutMs);
  try {
    const res = await fetchImpl(`${config.slide.baseUrl}/v1/sms/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.slide.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ senderId: senderId(), to: [to], message, ...(templateId ? { templateId } : {}), route: 'transactional' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ msg: 'sms_send_failed', status: res.status, templateKey });
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    logger.warn({ msg: 'sms_send_failed', err: e.message, templateKey });
    return { sent: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendSms, isConfigured, setFetch };
