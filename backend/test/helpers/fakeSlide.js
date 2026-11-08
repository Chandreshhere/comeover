'use strict';
// Scriptable fake of Slide's OTP API for tests (installed via lib/slide.setFetch).
function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function createFakeSlide({ phone = '+919876543210', code = '123456' } = {}) {
  const state = { calls: [], seq: 0, sendStatus: null, verifyIdentifier: phone, consumed: new Set() };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init && init.body ? JSON.parse(init.body) : {};
    state.calls.push({ path, body, auth: init.headers.authorization });
    if (path === '/v1/otp/send') {
      if (state.sendStatus === 429) return response(429, { statusCode: 429, error: 'Too Many Requests', message: 'slow down', retryAfter: 42 }, { 'retry-after': '42' });
      if (state.sendStatus === 500) return response(500, { statusCode: 500, error: 'Internal', message: 'boom' });
      state.seq += 1;
      return response(200, { requestId: `otpreq_${state.seq}`, channel: 'whatsapp' });
    }
    if (path === '/v1/otp/retry') return response(200, { requestId: body.requestId, channel: body.channel || 'sms' });
    if (path === '/v1/otp/verify') {
      if (body.otp !== code) return response(400, { statusCode: 400, error: 'Bad Request', message: 'Invalid OTP' });
      return response(200, { accessToken: `slide-token-${body.requestId}` });
    }
    if (path === '/v1/otp/verify-token') {
      if (state.consumed.has(body.accessToken)) return response(400, { statusCode: 400, message: 'Token already used' });
      state.consumed.add(body.accessToken);
      return response(200, { verified: true, identifier: state.verifyIdentifier, verifiedAt: new Date().toISOString() });
    }
    return response(404, { statusCode: 404, message: 'not found' });
  };
  return { state, fetchImpl };
}

module.exports = { createFakeSlide, response };
