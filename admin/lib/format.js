export function timeAgo(iso, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 0) return timeUntil(iso, now);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function timeUntil(iso, now = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const m = Math.round(Math.abs(s) / 60);
  const txt = m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`;
  return s >= 0 ? `in ${txt}` : `${txt} ago`;
}

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function date(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function inr(minor) {
  return `₹${Math.round((minor || 0) / 100).toLocaleString('en-IN')}`;
}

export function pct(v, digits = 0) {
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v) {
  return Number(v).toLocaleString('en-IN');
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

// Labels for the API's REASON_CODES (backend/src/services/safety.js).
export const REASONS = {
  harassment: 'Harassment',
  safety_threat: 'Safety threat / unsafe behaviour',
  dating_or_solicitation: 'Dating, paid company or selling',
  underage: 'Possibly under 18',
  impersonation: 'Fake profile / impersonation',
  spam: 'Spam / undisclosed promotion',
  scam: 'Scam',
  hate: 'Hate speech',
  inappropriate_content: 'Inappropriate content',
  no_show_abuse: 'Repeated no-shows',
  unsafe_venue: 'Unsafe / private venue',
  other: 'Other',
};

// Review SLA by report priority (backend priorities: low | normal | high | urgent).
export const SLA_HOURS = { urgent: 1, high: 4, normal: 24, medium: 24, low: 72 };
