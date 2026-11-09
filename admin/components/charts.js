'use client';
// Inline SVG and CSS charts. No chart library, solid colours only (no gradients).
//
// Palette, validated with the dataviz validator against the white card surface
// (the console is light only):
//   SERIES   categorical slots in a fixed order. Worst adjacent CVD dE 9.1, normal-vision
//            dE >= 22, every slot >= 3:1 on white; the first three also pass all-pairs.
//   ORDINAL  one-hue ramp for ordered stages (funnel). Light end 2.13:1 on white.
//   SEQ      one-hue sequential ramp for magnitude (heatmap, cohort cells). Step 0 means none.
// Labels inside a fill follow APCA: white on the series hues and the two darkest ramp steps.
import { useEffect, useRef, useState } from 'react';
import { compact, dayLabel, num } from '@/lib/format';

export const SERIES = ['#526fc3', '#cf7317', '#1f9e8f', '#b660c9'];
export const NEUTRAL = '#d9dce5';
export const ORDINAL = ['#93b0fb', '#7896ea', '#5d7dd4', '#4565bb', '#304c99'];
export const SEQ = ['#f2f3f8', '#e3eaff', '#c8d7ff', '#93b0fb', '#5d7dd4', '#304c99'];
const SEQ_TEXT = ['#767985', '#090a0e', '#090a0e', '#090a0e', '#ffffff', '#ffffff'];
const GRID = '#eceef4';
const AXIS = '#d9dce5';
const MUTED = '#767985';
const WASH = 0.1;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Axis labels: every `every`-th day plus the last one, skipping a label that would crowd the last.
const tickAt = (i, n, every) => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.6);

// Rendered width of a container, so SVG text stays at its real pixel size.
function useWidth(initial = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Clean axis ticks from 0. Counts get whole-number steps.
function niceScale(max, count = 4, integer = true) {
  if (!(max > 0)) return { top: integer ? count : 1, ticks: Array.from({ length: count + 1 }, (_, i) => (integer ? i : i / count)) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

// Bar with a 4px rounded data end and a square baseline.
function barPath(x, y, w, h, vertical = true) {
  if (!(w > 0) || !(h > 0)) return '';
  const r = Math.min(4, w / 2, h);
  if (vertical) return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

// ---------- chrome ----------
export function Legend({ items = [] }) {
  if (items.length < 2) return null;
  return (
    <div className="viz-legend" role="list">
      {items.map((it) => (
        <span key={it.label} className="viz-legend-item" role="listitem">
          <span className={`viz-key ${it.kind === 'line' ? 'line' : 'rect'}`} style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Tip({ x, y, width, children }) {
  if (x == null) return null;
  const flip = x > width - 190;
  return (
    <div className="viz-tip" style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y) }} role="status">
      {children}
    </div>
  );
}

function TipRow({ color, kind = 'line', value, label }) {
  return (
    <div className="viz-tip-row">
      {color ? <span className={`viz-key ${kind}`} style={{ background: color }} aria-hidden="true" /> : null}
      <b>{value}</b>
      <span className="viz-tip-label">{label}</span>
    </div>
  );
}

export function DataTable({ columns = [], rows = [] }) {
  return (
    <div className="table-wrap viz-table">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={c.num ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={columns[j]?.num ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Card with a title, optional legend, and a chart/table toggle (the table is the accessible twin).
export function ChartCard({ title, subtitle, legend, table, actions, footer, children, className = '' }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card viz-card ${className}`}>
      <div className="viz-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="h3">{title}</h2>
          {subtitle ? <div className="caption muted viz-sub">{subtitle}</div> : null}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {actions}
          {table ? (
            <button type="button" className="btn sm secondary viz-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? 'Chart' : 'Table'}
            </button>
          ) : null}
        </div>
      </div>
      {legend && !asTable ? <Legend items={legend} /> : null}
      <div className="viz-body">{asTable && table ? <DataTable {...table} /> : children}</div>
      {footer ? <div className="viz-foot caption muted">{footer}</div> : null}
    </section>
  );
}

export function ChartEmpty({ title = 'Nothing to show yet', body }) {
  return (
    <div className="viz-empty">
      <div className="label">{title}</div>
      {body ? <div className="caption muted">{body}</div> : null}
    </div>
  );
}

// ---------- sparkline ----------
export function Sparkline({ data = [], width = 160, height = 40, stroke = SERIES[0], fill, target, label }) {
  const pts = data.map((v) => (finite(v) ? v : null));
  const vals = pts.filter((v) => v != null);
  if (vals.length < 2) return <div style={{ height }} aria-hidden="true" />;
  const min = Math.min(...vals, target ?? Infinity, 0);
  const max = Math.max(...vals, target ?? -Infinity);
  const span = max - min || 1;
  const pad = 4;
  const x = (i) => pad + (i * (width - pad * 2)) / Math.max(1, pts.length - 1);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  let d = '';
  let open = false;
  pts.forEach((v, i) => {
    if (v == null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${x(i)},${y(v)} `;
    open = true;
  });
  const firstIdx = pts.findIndex((v) => v != null);
  let lastIdx = pts.length - 1;
  while (lastIdx > 0 && pts[lastIdx] == null) lastIdx -= 1;
  const solid = pts.every((v) => v != null);
  const area = solid ? `M${x(firstIdx)},${height - pad} ${pts.map((v, i) => `L${x(i)},${y(v)}`).join(' ')} L${x(lastIdx)},${height - pad} Z` : null;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label || 'trend'}>
      {area ? <path d={area} fill={fill || stroke} fillOpacity={fill ? 1 : WASH} stroke="none" /> : null}
      {target != null ? <line x1={pad} x2={width - pad} y1={y(target)} y2={y(target)} stroke={MUTED} strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------- line chart ----------
// series: [{ key, label, color, values: number[] (same length as days; null = gap) }]
export function LineChart({ days = [], series = [], height = 260, format = num, label = 'Line chart', area = false }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const m = { top: 14, right: 18, bottom: 30, left: 46 };
  const iw = Math.max(20, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = days.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter(finite)));
  const { top, ticks } = niceScale(max, 4, true);
  const x = (i) => m.left + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
  const y = (v) => m.top + ih - (v / top) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));

  const paths = series.map((s) => {
    let d = '';
    let open = false;
    s.values.forEach((v, i) => {
      if (!finite(v)) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${x(i)},${y(v)} `;
      open = true;
    });
    return d;
  });

  const pick = (clientX, rect) => {
    if (!n) return;
    const px = clientX - rect.left;
    const i = Math.round(((px - m.left) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={ref} className="viz-plot" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(n - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n - 1) - 1));
          if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? 0) + 1));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
            <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-axis">
              {compact(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          tickAt(i, n, every) ? (
            <text key={d} x={x(i)} y={m.top + ih + 18} textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'} className="viz-axis">
              {dayLabel(d)}
            </text>
          ) : null
        )}
        {area && series[0] && paths[0] && series[0].values.every(finite) ? (
          <path d={`${paths[0]} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={series[0].color} fillOpacity={WASH} stroke="none" />
        ) : null}
        {series.map((s, si) => (
          <path key={s.key || s.label} d={paths[si]} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + ih} stroke={AXIS} strokeWidth="1" />
            {series.map((s) =>
              finite(s.values[hover]) ? <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" /> : null
            )}
          </g>
        ) : null}
      </svg>
      {hover != null ? (
        <Tip x={x(hover)} y={m.top} width={width}>
          <div className="viz-tip-title">{dayLabel(days[hover], { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          {series.map((s) => (
            <TipRow key={s.label} color={s.color} value={finite(s.values[hover]) ? format(s.values[hover]) : 'n/a'} label={s.label} />
          ))}
        </Tip>
      ) : null}
    </div>
  );
}

// ---------- grouped bar chart ----------
export function BarChart({ days = [], series = [], height = 220, format = num, label = 'Bar chart' }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const m = { top: 12, right: 12, bottom: 30, left: 46 };
  const iw = Math.max(20, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = Math.max(1, days.length);
  const k = Math.max(1, series.length);
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter(finite)));
  const { top, ticks } = niceScale(max, 4, true);
  const band = iw / n;
  const gap = k > 1 ? Math.min(2, band * 0.08) : 0;
  const barW = Math.max(1, Math.min(24, (band * 0.72 - gap * (k - 1)) / k));
  const groupW = barW * k + gap * (k - 1);
  const y = (v) => m.top + ih - (v / top) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));
  return (
    <div ref={ref} className="viz-plot" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
            <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-axis">
              {compact(t)}
            </text>
          </g>
        ))}
        {hover != null ? <rect x={m.left + hover * band} y={m.top} width={band} height={ih} fill="#f2f3f8" /> : null}
        {days.map((d, i) => {
          const x0 = m.left + i * band + (band - groupW) / 2;
          return (
            <g key={d}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (!finite(v) || v <= 0) return null;
                return <path key={s.label} d={barPath(x0 + si * (barW + gap), y(v), barW, m.top + ih - y(v))} fill={s.color} />;
              })}
              {tickAt(i, n, every) ? (
                <text x={m.left + i * band + band / 2} y={m.top + ih + 18} textAnchor="middle" className="viz-axis">
                  {dayLabel(d)}
                </text>
              ) : null}
              <rect x={m.left + i * band} y={m.top} width={band} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null ? (
        <Tip x={m.left + hover * band + band / 2} y={m.top} width={width}>
          <div className="viz-tip-title">{dayLabel(days[hover], { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          {series.map((s) => (
            <TipRow key={s.label} color={s.color} kind="rect" value={finite(s.values[hover]) ? format(s.values[hover]) : 'n/a'} label={s.label} />
          ))}
        </Tip>
      ) : null}
    </div>
  );
}

// ---------- horizontal bars (ranked list) ----------
// items: [{ key?, label, value, detail? }]; one hue for every bar (a single series).
// `stacked` puts the label above its bar, for narrow cards with long labels.
export function HBarList({ items = [], color = SERIES[0], format = num, label = 'Bar list', stacked = false }) {
  const [hover, setHover] = useState(null);
  const top = Math.max(0, ...items.map((i) => (finite(i.value) ? i.value : 0)));
  return (
    <div className={`viz-hbars${stacked ? ' stacked' : ''}`} role="list" aria-label={label} onPointerLeave={() => setHover(null)}>
      {items.map((it, i) => {
        const w = top > 0 && finite(it.value) ? (it.value / top) * 100 : 0;
        return (
          <div
            key={it.key || it.label}
            className={`viz-hbar${hover === i ? ' on' : ''}`}
            role="listitem"
            tabIndex={it.detail ? 0 : undefined}
            onPointerEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <span className="viz-hbar-label" title={it.label}>
              {it.label}
            </span>
            <span className="viz-hbar-track">
              {w > 0 ? <span className="viz-hbar-fill" style={{ width: `${Math.max(w, 1.5)}%`, background: color }} /> : null}
            </span>
            <span className="viz-hbar-value">{finite(it.value) ? format(it.value) : 'n/a'}</span>
            {hover === i && it.detail ? <span className="viz-hbar-detail caption">{it.detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------- tall segmented bar (one whole, <= 6 parts) ----------
// parts: [{ label, value, color, text? }]; share printed inside a part only when it fits.
export function SegmentedBar({ parts = [], format = num, label = 'Share' }) {
  const [ref, width] = useWidth(480);
  const [hover, setHover] = useState(null);
  const total = parts.reduce((s, p) => s + (finite(p.value) ? p.value : 0), 0);
  if (!total) return <ChartEmpty title="No answers yet" />;
  const live = parts.filter((p) => finite(p.value) && p.value > 0);
  const gaps = Math.max(0, live.length - 1) * 2;
  const share = (p) => p.value / total;
  return (
    <div>
      <div ref={ref} className="viz-seg" role="img" aria-label={`${label}: ${live.map((p) => `${p.label} ${Math.round(share(p) * 100)}%`).join(', ')}`} onPointerLeave={() => setHover(null)}>
        {live.map((p, i) => {
          const px = share(p) * (width - gaps);
          const txt = `${Math.round(share(p) * 100)}%`;
          return (
            <span
              key={p.label}
              className={`viz-seg-part${hover === i ? ' on' : ''}`}
              style={{ flex: `${p.value} 1 0`, background: p.color, color: p.text || '#fff' }}
              onPointerEnter={() => setHover(i)}
            >
              {px > txt.length * 8 + 16 ? txt : ''}
            </span>
          );
        })}
      </div>
      <div className="viz-seg-caption caption" aria-hidden={hover == null}>
        {hover != null ? (
          <>
            <b>{live[hover].label}</b> {format(live[hover].value)} ({Math.round(share(live[hover]) * 100)}%)
          </>
        ) : (
          <span className="muted">Hover a part for the count</span>
        )}
      </div>
      <Legend items={live.map((p) => ({ label: p.label, color: p.color }))} />
    </div>
  );
}

// ---------- weekday x hour heatmap ----------
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
const binOf = (v, max) => (!(v > 0) || !(max > 0) ? 0 : Math.min(5, Math.max(1, Math.ceil((v / max) * 5))));

export function Heatmap({ values = [], unit = 'plans' }) {
  const [hover, setHover] = useState(null);
  const rows = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => Number(values?.[d]?.[h]) || 0));
  const max = Math.max(0, ...rows.flat());
  if (!max) return <ChartEmpty title={`No ${unit} in this range`} body="Start times appear here once people create plans." />;
  return (
    <div className="viz-heat-wrap" onPointerLeave={() => setHover(null)}>
      <div className="viz-heat" role="img" aria-label={`${unit} by weekday and start hour, IST`}>
        {rows.map((row, d) => (
          <div key={d} className="viz-heat-row">
            <span className="viz-heat-day caption">{WEEKDAYS[d]}</span>
            {row.map((v, h) => {
              const b = binOf(v, max);
              return <span key={h} className={`viz-heat-cell${hover && hover.d === d && hover.h === h ? ' on' : ''}`} style={{ background: SEQ[b] }} onPointerEnter={() => setHover({ d, h, v })} />;
            })}
          </div>
        ))}
        <div className="viz-heat-row viz-heat-hours" aria-hidden="true">
          <span className="viz-heat-day" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="caption muted">
              {h % 6 === 0 ? hourLabel(h) : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="viz-heat-foot">
        <span className="caption soft">
          {hover ? (
            <>
              <b>
                {num(hover.v)} {hover.v === 1 ? unit.replace(/s$/, '') : unit}
              </b>{' '}
              {WEEKDAYS_LONG[hover.d]}, {hourLabel(hover.h)} to {hourLabel((hover.h + 1) % 24)}
            </>
          ) : (
            'Start hour, IST. Hover a cell for the count.'
          )}
        </span>
        <ScaleLegend low="Fewer" high={`${num(max)} max`} />
      </div>
    </div>
  );
}

export function ScaleLegend({ low, high }) {
  return (
    <span className="viz-scale caption muted">
      {low}
      {SEQ.slice(1).map((c) => (
        <span key={c} className="viz-scale-step" style={{ background: c }} />
      ))}
      {high}
    </span>
  );
}

// ---------- cohort retention table ----------
// cohorts: [{ week: 'YYYY-MM-DD', size, weeks: [rate|null x 8] }], oldest first.
export function CohortTable({ cohorts = [] }) {
  const cols = Math.max(0, ...cohorts.map((c) => (c.weeks || []).length));
  if (!cohorts.some((c) => c.size > 0)) return <ChartEmpty title="No sign-ups in the last 8 weeks" body="Weekly cohorts fill in as people join." />;
  return (
    <div>
      <div className="table-wrap">
        <table className="viz-cohort">
          <thead>
            <tr>
              <th>Signed up</th>
              <th className="num">People</th>
              {Array.from({ length: cols }, (_, k) => (
                <th key={k} className="num">
                  {k === 0 ? 'Wk 0' : `${k}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.week}>
                <td className="viz-cohort-week">Week of {dayLabel(c.week)}</td>
                <td className="num">{num(c.size || 0)}</td>
                {Array.from({ length: cols }, (_, k) => {
                  const r = c.weeks?.[k];
                  if (!c.size || !finite(r)) return <td key={k} className="viz-cohort-cell none" />;
                  const b = r === 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(r * 5)));
                  return (
                    <td key={k} className="viz-cohort-cell" style={{ background: SEQ[b], color: SEQ_TEXT[b] }} title={`${Math.round(r * 100)}% of ${num(c.size)} active in week ${k}`}>
                      {Math.round(r * 100)}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="viz-heat-foot">
        <span className="caption muted">Share of each signup week active in later weeks. Week 0 is the signup week.</span>
        <ScaleLegend low="0%" high="100%" />
      </div>
    </div>
  );
}

// ---------- funnel (ordered stages, one-hue ramp) ----------
export function Funnel({ steps = [] }) {
  const top = Math.max(0, ...steps.map((s) => (finite(s.value) ? s.value : 0)));
  if (!top) return <ChartEmpty title="No sign-ups in this range" body="The funnel follows people who signed up in the selected range." />;
  const ramp = steps.length <= ORDINAL.length ? ORDINAL.slice(0, steps.length) : steps.map((_, i) => ORDINAL[Math.min(ORDINAL.length - 1, i)]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {steps.map((s, i) => {
        const v = finite(s.value) ? s.value : 0;
        const prev = i > 0 && finite(steps[i - 1].value) ? steps[i - 1].value : null;
        const step = prev ? v / prev : null;
        return (
          <div key={s.label}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="label">{s.label}</span>
              <span className="label">
                {num(v)}
                {step != null ? <span className="muted"> · {Math.round(step * 100)}% of previous</span> : null}
              </span>
            </div>
            <div className="viz-funnel-track">
              {v > 0 ? <div style={{ width: `${Math.max(1.5, (v / top) * 100)}%`, background: ramp[i] }} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- columns (few ordered values, one hue) ----------
export function Columns({ data = [], height = 140, format = (v) => v, color = SERIES[0], emptyLabel = 'n/a' }) {
  const max = Math.max(0, ...data.map((d) => (finite(d.value) ? d.value : 0)));
  return (
    <div className="viz-columns" style={{ height: height + 40 }} role="img" aria-label={data.map((d) => `${d.label} ${finite(d.value) ? format(d.value) : emptyLabel}`).join(', ')}>
      {data.map((d) => {
        const ok = finite(d.value);
        const h = ok && max > 0 ? Math.max(ok && d.value > 0 ? 3 : 0, (d.value / max) * height) : 0;
        return (
          <div key={d.label} className="viz-column">
            <span className={`label${ok ? '' : ' muted'}`}>{ok ? format(d.value) : emptyLabel}</span>
            <div className="viz-column-bar" style={{ height: h, background: color }} />
            <span className="caption muted">{d.label}</span>
          </div>
        );
      })}
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
