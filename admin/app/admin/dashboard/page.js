'use client';
// Overview dashboard: GET /admin/insights?range=7d|30d|90d (IST days), plus plan liquidity
// and urgent reports from GET /admin/kpis (7d and 30d only).
import { useState } from 'react';
import api from '@/lib/api';
import Icon from '@/components/Icon';
import InsightsDashboard from '@/components/InsightsDashboard';
import { useSession } from '@/components/Shell';
import { ErrorBox, PageHead, Skeleton, useLoad } from '@/components/ui';

const RANGES = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
];

export default function DashboardPage() {
  const session = useSession();
  const [range, setRange] = useState('30d');
  const { data: k, error, loading, reload } = useLoad(() => api.insights(range), [range]);
  const { data: legacy } = useLoad(() => (range === '90d' ? Promise.resolve(null) : api.kpis(range).catch(() => null)), [range]);
  const rangeLabel = RANGES.find(([r]) => r === range)[1];

  return (
    <>
      <PageHead eyebrow={`Overview · ${rangeLabel} · IST`} title={`Hello, ${String(session?.name || 'team').split(' ')[0]}`}>
        <div className="tabs" role="tablist" aria-label="Range">
          {RANGES.map(([r]) => (
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
        <div className="dash">
          <div className="dash-kpis">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} h={168} />
            ))}
          </div>
          <Skeleton h={320} />
        </div>
      ) : null}

      {k ? <InsightsDashboard k={k} legacy={legacy} loading={loading} /> : null}
    </>
  );
}

