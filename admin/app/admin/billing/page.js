'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { listOf, normCampaign, normSubscription } from '@/lib/normalize';
import Icon from '@/components/Icon';
import { Empty, ErrorBox, PageHead, Skeleton, StatusBadge, UserLink, fmtMaybe, useLoad } from '@/components/ui';
import { date, inr, num, pct } from '@/lib/format';

function Subscriptions() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, loading, reload } = useLoad(() => api.subscriptions({ q: query }), [query]);
  const rows = listOf(data).map(normSubscription);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="h2">Subscriptions & entitlements</h2>
        <div className="row" style={{ background: 'var(--surface)', borderRadius: 999, border: '1.2px solid var(--border)', padding: '0 14px', height: 40, minWidth: 260 }}>
          <Icon name="search" size={16} />
          <input aria-label="Search subscriptions" placeholder="User id, name or store transaction" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 'none', outline: 'none', flex: 1, background: 'transparent' }} />
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Skeleton h={200} />
      ) : !rows.length ? (
        error ? null : <Empty title="No subscriptions found" body={query ? 'Try a different search.' : 'No paid subscriptions yet.'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Store</th>
                <th>Product</th>
                <th>Status</th>
                <th>Entitlement</th>
                <th>Renews / expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const key = s.id || i;
                const entitled = s.entitled ?? (['active', 'grace_period', 'cancelled', 'in_grace_period'].includes(s.status) && s.expiresAt && new Date(s.expiresAt) > new Date());
                return [
                  <tr key={key}>
                    <td>
                      <UserLink user={s.user} />
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{s.store || '—'}</td>
                    <td className="mono">{s.productId || '—'}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>{entitled ? <span className="badge ok">{s.tier || 'paid'}</span> : <span className="badge">free</span>}</td>
                    <td className="soft">{s.expiresAt ? date(s.expiresAt) : '—'}</td>
                    <td>
                      <button className="btn sm secondary" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                        {open === key ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>,
                  open === key ? (
                    <tr key={`${key}-d`}>
                      <td colSpan={7} style={{ background: 'var(--surface-subtle)' }}>
                        <div className="row wrap" style={{ gap: 24 }}>
                          <span>
                            <span className="eyebrow">Started</span>
                            <br />
                            {s.startedAt ? date(s.startedAt) : '—'}
                          </span>
                          <span>
                            <span className="eyebrow">Store transaction</span>
                            <br />
                            <span className="mono">{s.txn || '—'}</span>
                          </span>
                          <span style={{ flex: 1, minWidth: 240 }}>
                            <span className="eyebrow">Support note</span>
                            <br />
                            {s.note || 'No notes.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Campaigns() {
  const { data, error, loading, reload } = useLoad(() => api.campaigns(), []);
  const rows = listOf(data).map(normCampaign);
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="h2">Sponsored campaigns</h2>
        <span className="caption muted">Always labelled “Sponsored” in the app · no guaranteed attendance</span>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Skeleton h={160} />
      ) : !rows.length ? (
        error ? null : <Empty title="No campaigns yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Campaign</th>
                <th>Status</th>
                <th className="num">Budget</th>
                <th className="num">Impressions</th>
                <th className="num">Joins</th>
                <th className="num">Check-ins</th>
                <th className="num">Check-in rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id || i}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.venue || '—'}</div>
                    {c.area ? <div className="caption muted">{c.area}</div> : null}
                  </td>
                  <td>
                    {c.title || '—'}
                    <div className="caption muted">
                      {[c.days ? `${c.days} days` : null, c.startsAt ? `from ${date(c.startsAt)}` : null, c.labelled ? 'labelled' : 'NOT labelled'].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="num">{fmtMaybe(c.budgetMinor, inr)}</td>
                  <td className="num">{fmtMaybe(c.impressions, num)}</td>
                  <td className="num">{fmtMaybe(c.joins, num)}</td>
                  <td className="num">{fmtMaybe(c.checkIns, num)}</td>
                  <td className="num">{c.joins ? pct((c.checkIns || 0) / c.joins) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <>
      <PageHead eyebrow="Business" title="Billing support" />
      <div className="stack">
        <div className="notice">
          <Icon name="lock" />
          <div>
            <b>No card or UPI data lives here.</b> Subscriptions are billed by the App Store / Google Play; venue plans through the payment partner. This screen is read-only entitlement state. Refunds and cancellations happen in the store and reach the backend via store server notifications.
          </div>
        </div>
        <Subscriptions />
        <Campaigns />
      </div>
    </>
  );
}
