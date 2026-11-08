// Small inline SVG charts — no chart library, consistent with the token palette.

export function Sparkline({ data = [], width = 160, height = 44, stroke = '#090A0E', fill = 'rgba(156,185,255,0.35)', target, label }) {
  if (!data.length) return null;
  const min = Math.min(...data, target ?? Infinity);
  const max = Math.max(...data, target ?? -Infinity);
  const span = max - min || 1;
  const pad = 4;
  const x = (i) => pad + (i * (width - pad * 2)) / Math.max(1, data.length - 1);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `M${x(0)},${height - pad} L${pts.replace(/ /g, ' L')} L${x(data.length - 1)},${height - pad} Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label || 'trend'}>
      <path d={area} fill={fill} stroke="none" />
      {target != null ? <line x1={pad} x2={width - pad} y1={y(target)} y2={y(target)} stroke="#767985" strokeDasharray="3 4" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3.2" fill={stroke} />
    </svg>
  );
}

export function Funnel({ steps = [] }) {
  const top = steps[0]?.value || 1;
  const colors = ['#9CB9FF', '#E5E3FA', '#F0A34B', '#090A0E'];
  return (
    <div className="stack" style={{ gap: 10 }}>
      {steps.map((s, i) => {
        const ratio = s.value / top;
        const step = i > 0 ? s.value / steps[i - 1].value : null;
        return (
          <div key={s.label}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="label">{s.label}</span>
              <span className="label">
                {s.value.toLocaleString('en-IN')}
                {step != null ? <span className="muted"> · {Math.round(step * 100)}% of prev</span> : null}
              </span>
            </div>
            <div style={{ height: 22, borderRadius: 11, background: '#F7F7FA', overflow: 'hidden' }}>
              <div style={{ width: `${ratio * 100}%`, height: '100%', borderRadius: 11, background: colors[i % colors.length] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Columns({ data = [], height = 120, format = (v) => v }) {
  const max = Math.max(...data.map((d) => d.value), 0.0001);
  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 14, height: height + 34 }} role="img" aria-label={data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}>
      {data.map((d, i) => (
        <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span className="label">{format(d.value)}</span>
          <div style={{ width: '100%', maxWidth: 56, height: (d.value / max) * height, borderRadius: 14, background: i === data.length - 1 ? '#090A0E' : i === 1 ? '#9CB9FF' : '#E5E3FA' }} />
          <span className="caption muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function RiskMeter({ value }) {
  const color = value >= 0.7 ? '#D94F62' : value >= 0.4 ? '#F0A34B' : '#2F9E75';
  return (
    <div className="row" style={{ gap: 8 }} title={`Risk score ${Math.round(value * 100)}`}>
      <div style={{ width: 70, height: 7, borderRadius: 99, background: '#E8EAF2', overflow: 'hidden' }}>
        <div style={{ width: `${value * 100}%`, height: '100%', background: color }} />
      </div>
      <span className="label">{Math.round(value * 100)}</span>
    </div>
  );
}
