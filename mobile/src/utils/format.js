// Formatting helpers. Distances are always coarse (never exact) per the
// privacy rules in 08_api_contract.json.

export function coarseDistance(meters) {
  if (meters == null) return 'Nearby';
  if (meters < 300) return '< 300 m';
  if (meters < 1000) return `${Math.round(meters / 100) * 100} m`;
  if (meters < 10000) return `${(Math.round(meters / 500) * 0.5).toFixed(1).replace('.0', '')} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function timeLabel(date) {
  const d = new Date(date);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function relativeDay(date, now = new Date()) {
  const d = new Date(date);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DAY[d.getDay()];
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

export function whenLabel(date, now = new Date()) {
  const d = new Date(date);
  const mins = Math.round((d - now) / 60000);
  if (mins <= 0 && mins > -120) return 'Happening now';
  if (mins > 0 && mins < 60) return `in ${mins} min`;
  return `${relativeDay(d, now)} · ${timeLabel(d)}`;
}

export function durationLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function inr(minor) {
  const rupees = (minor || 0) / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 1 ? 2 : 0 })}`;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Hey';
  return 'Good evening';
}

export const weekdayShort = DAY;
export const monthShort = MONTH;
