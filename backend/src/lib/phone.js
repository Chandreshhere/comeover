'use strict';
// Phone number helpers (India-first). 10-digit Indian mobiles → +91; else strict E.164.
const { err } = require('./http');

function normalizePhone(raw) {
  if (raw == null) throw err.badRequest('invalid_phone', 'Enter a valid mobile number');
  let s = String(raw).replace(/[\s\-().]/g, '');
  if (/^0?[6-9]\d{9}$/.test(s)) s = `+91${s.slice(-10)}`;
  else if (/^91[6-9]\d{9}$/.test(s)) s = `+${s}`;
  else if (/^00\d{8,15}$/.test(s)) s = `+${s.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) throw err.badRequest('invalid_phone', 'Enter a valid mobile number');
  if (s.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(s)) throw err.badRequest('invalid_phone', 'Enter a valid Indian mobile number');
  return s;
}

// +919876543210 → +91 ••••• •3210
function maskPhone(e164) {
  const s = String(e164 || '');
  if (s.length < 6) return '••••';
  const cc = s.startsWith('+91') ? '+91' : s.slice(0, s.length - 10 > 1 ? s.length - 10 : 2);
  return `${cc} ••••• •${s.slice(-4)}`;
}

module.exports = { normalizePhone, maskPhone };
