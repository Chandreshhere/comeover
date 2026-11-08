'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';

// Live SLA countdown. high = 4h, medium = 24h, low = 72h from report creation.
export default function SlaTimer({ dueAt, resolved = false }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resolved) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [resolved]);
  if (resolved) return <span className="badge">resolved</span>;
  const ms = new Date(dueAt).getTime() - now;
  const mins = Math.round(Math.abs(ms) / 60000);
  const txt = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  const tone = ms < 0 ? 'bad' : ms < 60 * 60000 ? 'warn' : 'ok';
  return (
    <span className={`badge ${tone}`} title={`SLA due ${new Date(dueAt).toLocaleString('en-IN')}`}>
      <Icon name="clock" size={12} />
      {ms < 0 ? `breached ${txt}` : `${txt} left`}
    </span>
  );
}
