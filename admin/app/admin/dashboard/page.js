'use client';
import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { g, listOf } from '@/lib/normalize';
import { Columns, Funnel, Sparkline } from '@/components/charts';
import Icon from '@/components/Icon';
import Mascot from '@/components/Mascot';
import { Empty, ErrorBox, PageHead, Skeleton, useLoad } from '@/components/ui';
import { useSession } from '@/components/Shell';
import { num, pct } from '@/lib/format';

// GET /admin/kpis?range=7d|30d — shape not final, so every section is optional
// and metric tiles are derived from whatever the backend returns.

const RATE_HINT = /(rate|conversion|activation|retention|churn|share|ratio|pct|percent)/i;

const LABELS = {
  activation: ['Activation', 'New users who join or create within 7 days'],
  planLiquidityMedianMin: ['Plan liquidity', 'Median minutes from publish to first accepted participant'],
  liquidity: ['Plan liquidity', 'Median minutes from publish to first accepted participant'],
  joinConversion: ['Join conversion', 'Accepted joins / join requests'],
  showUpRate: ['Show-up rate', 'Completed check-ins / accepted participants'],
  completionRate: ['Completion rate', 'Mutually confirmed plans / accepted plans'],
  d7Retention: ['D7 retention', 'Active 7 days after activation'],
  d30Retention: ['D30 retention', 'Active 30 days after activation'],
  weeklyCompletedPerWau: ['Completed activities / WAU', 'North-star engagement measure'],
  safetyIncidentsPer1000: ['Safety incidents / 1,000 meetups', 'Substantiated incidents per completed meetups'],
  paidConversion: ['Paid conversion', 'Paid subscribers / eligible active users'],
  churn: ['Monthly churn', 'Cancellations / paid subscribers'],
};

const camel = (s) => String(s).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const humanise = (k) => camel(k).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function toMetric(key, raw) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { value: raw };
  const k = camel(g(obj, 'key') || key);
  const value = Number(g(obj, 'value', 'current'));
  if (Number.isNaN(value)) return null;
  const [label, hint] = LABELS[k] || [g(obj, 'label') || humanise(k), g(obj, 'hint', 'description')];
  let format = g(obj, 'format', 'unit');
  if (!format) format = /min/i.test(k) ? 'min' : RATE_HINT.test(k) && value <= 1 ? 'pct' : value % 1 ? 'num1' : 'int';
  const series = (g(obj, 'series', 'trend') || []).map((p) => Number(typeof p === 'object' ? g(p, 'value', 'v') : p)).filter((v) => !Number.isNaN(v));
  const target = g(obj, 'target') != null ? Number(g(obj, 'target')) : undefined;
  const good = g(obj, 'good', 'direction') || (/(churn|incident|liquidity|min)/i.test(k) ? 'down' : 'up');
  return { key: k, label, hint, value, format, series, target, good };
}

function fmt(m, v = m.value) {
  if (m.format === 'pct' || m.format === 'percent') return pct(v, v < 0.1 ? 1 : 0);
  if (m.format === 'pct1') return pct(v, 1);
  if (m.format === 'min' || m.format === 'minutes') return `${Math.round(v)} min`;
  if (m.format === 'num1') return v.toFixed(2);
  return num(Math.round(v));
}

function Kpi({ m }) {
  const prev = m.series.length > 1 ? m.series[m.series.length - 2] : null;
  const diff = prev != null ? m.value - prev : null;
  const better = diff == null ? null : m.good === 'down' ? diff <= 0 : diff >= 0;
  const onTarget = m.target == null ? null : m.good === 'down' ? m.value <= m.target : m.value >= m.target;
  return (
    <div className="kpi" title={m.hint}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label soft">{m.label}</span>
        {onTarget != null ? <span className={`badge ${onTarget ? 'ok' : 'warn'}`}>{onTarget ? 'on target' : 'below target'}</span> : null}
      </div>
      <div className="value">{fmt(m)}</div>
      <div className="row" style={{ gap: 6 }}>
        {diff != null ? <span className={`delta ${better ? 'good' : 'bad'}`}>{diff >= 0 ? '+' : ''}{m.format?.startsWith('pct') ? `${(diff * 100).toFixed(1)} pts` : fmt(m, diff)} vs prev</span> : null}
        {m.target != null ? <span className="caption muted">target {fmt(m, m.target)}</span> : null}
      </div>
      {m.series.length > 1 ? <Sparkline data={m.series} target={m.target} label={`${m.label} trend`} /> : null}
      {m.hint ? <span className="caption muted">{m.hint}</span> : null}
    </div>
  );
}

export default function DashboardPage() {
  const session = useSession();
  const [range, setRange] = useState('7d');
  const { data: k, error, loading, reload } = useLoad(() => api.kpis(range), [range]);

  const metricsRaw = g(k, 'metrics', 'kpis');
  const metrics = (
    Array.isArray(metricsRaw)
      ? metricsRaw.map((m, i) => toMetric(g(m, 'key', 'name') || `metric${i}`, m))
      : metricsRaw && typeof metricsRaw === 'object'
        ? Object.entries(metricsRaw).map(([key, v]) => toMetric(key, v))
        : k
          ? Object.entries(k)
              .filter(([key, v]) => (typeof v === 'number' || (v && typeof v === 'object' && 'value' in v)) && !/^(range|generatedAt)$/.test(key))
              .map(([key, v]) => toMetric(key, v))
          : []
  ).filter(Boolean);

  const ns = g(k, 'northStar', 'north_star');
  const nsValue = ns != null ? Number(typeof ns === 'object' ? g(ns, 'value') : ns) : null;
  const nsSeries = (g(ns, 'series') || []).map(Number).filter((v) => !Number.isNaN(v));
  const mod = g(k, 'moderation', 'queue');
  const funnel = listOf(g(k, 'funnel') || []).map((s) => ({ label: g(s, 'label', 'step', 'name'), value: Number(g(s, 'value', 'count')) || 0 }));
  const retention = listOf(g(k, 'retention') || []).map((s) => ({ label: g(s, 'label', 'day'), value: Number(g(s, 'value', 'rate')) || 0 }));
  const clusters = listOf(g(k, 'clusters', 'areas') || []);

  return (
    <>
      <PageHead eyebrow={`Overview · ${range === '7d' ? 'last 7 days' : 'last 30 days'}`} title={`Hello, ${String(session?.name || 'team').split(' ')[0]}`}>
        <div className="tabs" role="tablist" aria-label="Range">
          {['7d', '30d'].map((r) => (
            <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
        <button className="btn secondary sm" onClick={reload} disabled={loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />

      {loading && !k ? (
        <div className="grid-kpi">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={150} />
          ))}
        </div>
      ) : null}

      {k ? (
        <div className="stack">
          {nsValue != null || mod ? (
            <div className="cols-2">
              {nsValue != null && !Number.isNaN(nsValue) ? (
                <div className="card hero" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', right: 8, bottom: -8 }} aria-hidden="true">
                    <Mascot size={150} />
                  </div>
                  <div className="eyebrow" style={{ color: 'var(--ink-soft)' }}>
                    North-star metric
                  </div>
                  <h2 className="h2" style={{ marginTop: 4 }}>
                    {g(ns, 'label') || 'Weekly completed activities per WAU'}
                  </h2>
                  <div style={{ fontSize: 56, lineHeight: '60px', fontWeight: 700, letterSpacing: -1.5, marginTop: 8 }}>{nsValue.toFixed(2)}</div>
                  {nsSeries.length > 1 ? (
                    <div style={{ maxWidth: '62%', marginTop: 8 }}>
                      <Sparkline data={nsSeries} target={g(ns, 'target')} fill="rgba(255,255,255,0.45)" height={56} label="North star trend" />
                    </div>
                  ) : null}
                  <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
                    {g(ns, 'completed') != null ? <span className="badge ink">{num(g(ns, 'completed'))} completed meetups</span> : null}
                    {g(ns, 'wau') != null ? <span className="badge" style={{ background: 'rgba(255,255,255,0.55)' }}>{num(g(ns, 'wau'))} weekly active users</span> : null}
                  </div>
                </div>
              ) : (
                <div />
              )}
              {mod ? (
                <div className="card ink">
                  <div className="card-head">
                    <h2 className="h2" style={{ color: 'var(--surface)' }}>
                      Moderation queue
                    </h2>
                    <Link href="/admin/reports" className="btn sm light">
                      Open queue
                    </Link>
                  </div>
                  {[
                    ['Open reports', g(mod, 'open', 'openReports', 'open_reports'), '/admin/reports', 'flag'],
                    ['SLA breached', g(mod, 'slaBreached', 'sla_breached'), '/admin/reports', 'clock'],
                    ['Appeals pending', g(mod, 'appealsPending', 'appeals_pending'), '/admin/reports', 'refresh'],
                    ['Flagged activities', g(mod, 'activitiesPending', 'activities_pending', 'flaggedActivities', 'flagged_activities'), '/admin/activities', 'calendar'],
                  ]
                    .filter(([, v]) => v != null)
                    .map(([label, v, href, icon]) => (
                      <Link key={label} href={href} className="qrow soft">
                        <span className="ic">
                          <Icon name={icon} />
                        </span>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span className="go">{num(v)}</span>
                      </Link>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {metrics.length ? (
            <div className="grid-kpi">
              {metrics.map((m) => (
                <Kpi key={m.key} m={m} />
              ))}
            </div>
          ) : null}

          {funnel.length || retention.length ? (
            <div className="cols-even">
              {funnel.length ? (
                <div className="card">
                  <div className="card-head">
                    <h2 className="h2">Plan lifecycle funnel</h2>
                  </div>
                  <Funnel steps={funnel} />
                </div>
              ) : null}
              {retention.length ? (
                <div className="card">
                  <div className="card-head">
                    <h2 className="h2">Retention</h2>
                  </div>
                  <Columns data={retention} format={(v) => pct(v)} />
                </div>
              ) : null}
            </div>
          ) : null}

          {clusters.length ? (
            <div className="card">
              <div className="card-head">
                <h2 className="h2">Neighbourhood density</h2>
                <span className="caption muted">Expand only when a cluster is predictable</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Area</th>
                      <th className="num">Plans</th>
                      <th className="num">Median time to first accept</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clusters.map((c, i) => (
                      <tr key={g(c, 'id', 'name') || i}>
                        <td style={{ fontWeight: 600 }}>{g(c, 'name', 'area')}</td>
                        <td className="num">{g(c, 'plans', 'plansWeek', 'plans_week') != null ? num(g(c, 'plans', 'plansWeek', 'plans_week')) : '—'}</td>
                        <td className="num">{g(c, 'medianAcceptMin', 'median_accept_min') != null ? `${g(c, 'medianAcceptMin', 'median_accept_min')} min` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!metrics.length && nsValue == null && !mod && !funnel.length ? (
            <div className="card">
              <Empty title="No KPI data yet" body="The KPI endpoint responded but returned no recognised metrics for this range." />
              <details>
                <summary className="caption muted">Raw response</summary>
                <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(k, null, 2)}</pre>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
