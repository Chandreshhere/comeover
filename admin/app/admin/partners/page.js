'use client';
// Partners: venues, clubs and organisers who applied through the app's business
// hub. Review the proof document and the pin, then verify, reject or suspend.
// Verifying makes the venue and its offers visible to everyone in the app.
// Offers (GET /admin/offers, POST /admin/offers/{id}/status) and Redemptions
// (GET /admin/redemptions) show a calm "not available yet" state until the API has them.
import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import Icon from '@/components/Icon';
import ActionDialog from '@/components/ActionDialog';
import { Empty, ErrorBox, LoadMore, PageHead, Skeleton, StatusBadge, useCursorList, useToast } from '@/components/ui';
import { dateTime, num, timeAgo } from '@/lib/format';

const VIEWS = [
  ['businesses', 'Businesses'],
  ['offers', 'Offers'],
  ['redemptions', 'Redemptions'],
];

const TABS = [
  ['pending', 'Pending'],
  ['verified', 'Verified'],
  ['rejected', 'Rejected'],
  ['suspended', 'Suspended'],
  ['all', 'All'],
];

const DECISIONS = {
  verify: { value: 'verify', label: 'Verify', description: 'The venue and its offers go live in the app.' },
  reject: { value: 'reject', label: 'Reject', description: 'The owner sees your reason in the business hub and can apply again.', danger: true },
  suspend: { value: 'suspend', label: 'Suspend', description: 'Hides the venue and its offers immediately.', danger: true },
};

const optionsFor = (status) => {
  if (status === 'verified') return [DECISIONS.suspend];
  if (status === 'suspended') return [DECISIONS.verify, DECISIONS.reject];
  if (status === 'rejected') return [DECISIONS.verify];
  return [DECISIONS.verify, DECISIONS.reject];
};

function Fact({ label, children }) {
  return (
    <span style={{ minWidth: 150 }}>
      <span className="eyebrow">{label}</span>
      <br />
      {children}
    </span>
  );
}

function PartnerCard({ b, onDecide }) {
  const v = b.venue || {};
  const map = v.latitude != null && v.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}` : null;
  const status = b.verificationStatus;
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <h2 className="h2" style={{ margin: 0 }}>
              {b.name}
            </h2>
            <StatusBadge status={status} />
            {b.kind ? <span className="badge">{b.kind}</span> : null}
            {b.planId ? <span className="badge lav">{b.planId} plan</span> : null}
          </div>
          <div className="caption muted" style={{ marginTop: 4 }}>
            {[v.name && v.name !== b.name ? v.name : null, v.venueType, v.area].filter(Boolean).join(' · ')}
            {b.createdAt ? ` · applied ${timeAgo(b.createdAt)}` : ''}
          </div>
        </div>
        <div className="row">
          {optionsFor(status).map((o) => (
            <button key={o.value} className={`btn sm${o.danger ? ' danger' : ''}`} onClick={() => onDecide(b, o.value)}>
              {o.value === 'verify' ? <Icon name="check" size={14} /> : null} {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 24, marginTop: 16 }}>
        <Fact label="Address">
          {v.address || 'n/a'}
          {map ? (
            <>
              <br />
              <a href={map} target="_blank" rel="noreferrer" className="caption">
                Check the pin on a map
              </a>
            </>
          ) : null}
        </Fact>
        <Fact label="Contact">
          {b.contact?.name || 'n/a'}
          <br />
          <span className="mono">{b.contact?.phone || 'no phone'}</span>
          <br />
          {b.contact?.email || 'no email'}
        </Fact>
        <Fact label="Proof document">
          {b.proofUrl ? (
            <a href={b.proofUrl} target="_blank" rel="noreferrer">
              Open (link expires in 10 min)
            </a>
          ) : (
            <span className="muted">Not available</span>
          )}
          {b.gstin ? (
            <>
              <br />
              <span className="mono">GSTIN {b.gstin}</span>
            </>
          ) : null}
        </Fact>
        <Fact label="Offers">
          {num(b.offers?.active ?? 0)} active of {num(b.offers?.total ?? 0)}
        </Fact>
        <Fact label="Verified visits, 30 days">{num(b.verifiedVisits30d ?? 0)}</Fact>
      </div>

      {(v.categories || []).length || v.bookingUrl ? (
        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          {(v.categories || []).map((c) => (
            <span key={c} className="badge">
              {c}
            </span>
          ))}
          {v.bookingUrl ? (
            <a href={v.bookingUrl} target="_blank" rel="noreferrer" className="caption" style={{ marginLeft: 4 }}>
              Booking page
            </a>
          ) : null}
        </div>
      ) : null}

      {b.reviewNote ? (
        <div className="caption muted" style={{ marginTop: 12 }}>
          Last note: {b.reviewNote}
        </div>
      ) : null}
    </div>
  );
}

function NotYet({ what }) {
  return (
    <div className="card">
      <Empty title="Not available yet" body={`${what} will show here once the partner API is deployed.`} />
    </div>
  );
}

function BusinessesView() {
  const [status, setStatus] = useState('pending');
  const [counts, setCounts] = useState(null);
  const list = useCursorList(
    async (cursor) => {
      const res = await api.businesses({ status, cursor });
      if (res && res.counts) setCounts(res.counts);
      return res;
    },
    (x) => x,
    [status]
  );
  const [target, setTarget] = useState(null);
  const [toast, showToast] = useToast();

  return (
    <>
      <div className="stack">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist" aria-label="Verification status">
            {TABS.map(([v, l]) => (
              <button key={v} role="tab" aria-selected={status === v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>
                {l}
                {counts && counts[v] ? ` · ${counts[v]}` : ''}
              </button>
            ))}
          </div>
          <button className="btn secondary sm" onClick={list.reload} disabled={list.loading}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>

        {status === 'pending' ? (
          <div className="notice">
            <Icon name="shield" />
            <div>
              <b>Before you verify:</b> the proof (shop licence, FSSAI, GST certificate or a utility bill) matches the business name and address, the map pin is the real place, and it is a public venue, never a home or hotel room. Verified venues and their offers go live immediately.
            </div>
          </div>
        ) : null}

        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading ? (
          <Skeleton h={300} />
        ) : !list.items.length ? (
          list.error ? null : (
            <div className="card">
              <Empty
                title={status === 'pending' ? 'No applications waiting' : 'Nothing here'}
                body={status === 'pending' ? 'New venues appear here when an owner applies from the app (Partner places, List your venue).' : 'Try another tab.'}
              />
            </div>
          )
        ) : (
          <>
            {list.items.map((b) => (
              <PartnerCard key={b.id} b={b} onDecide={(biz, decision) => setTarget({ b: biz, decision })} />
            ))}
            <LoadMore list={list} />
          </>
        )}
      </div>

      <ActionDialog
        open={!!target}
        title={target ? `${DECISIONS[target.decision].label} ${target.b.name}` : ''}
        subtitle={target ? DECISIONS[target.decision].description : ''}
        options={target ? optionsFor(target.b.verificationStatus) : []}
        defaultValue={target?.decision}
        confirmLabel="Confirm"
        onClose={() => setTarget(null)}
        onSubmit={async ({ action, reason }) => {
          const res = await api.businessVerification(target.b.id, { decision: action, reason });
          const next = res?.verificationStatus || { verify: 'verified', reject: 'rejected', suspend: 'suspended' }[action];
          list.setItems((items) => (status === 'all' ? items.map((x) => (x.id === target.b.id ? { ...x, verificationStatus: next, reviewNote: reason } : x)) : items.filter((x) => x.id !== target.b.id)));
          setCounts((c) => (c ? { ...c, [target.b.verificationStatus]: Math.max(0, (c[target.b.verificationStatus] || 1) - 1), [next]: (c[next] || 0) + 1 } : c));
          showToast(next === 'verified' ? `${target.b.name} is live` : `${target.b.name} ${next}`);
        }}
      />
      {toast}
    </>
  );
}

// ---------------- offers ----------------
const OFFER_TABS = [
  ['active', 'Active'],
  ['paused', 'Paused'],
  ['ended', 'Ended'],
  ['all', 'All'],
];

const OFFER_ACTIONS = {
  paused: { value: 'paused', label: 'Pause', description: 'Hidden from members until resumed. Codes already issued still work until they expire.' },
  active: { value: 'active', label: 'Resume', description: 'Visible again to members who meet the unlock rules.' },
  ended: { value: 'ended', label: 'End', description: 'Removes the offer for good. The venue can create a new one.', danger: true },
};

const offerOptions = (status) => (status === 'active' ? [OFFER_ACTIONS.paused, OFFER_ACTIONS.ended] : status === 'paused' ? [OFFER_ACTIONS.active, OFFER_ACTIONS.ended] : [OFFER_ACTIONS.active]);

function unlockText(o) {
  const parts = [];
  if (o.minLevel > 1) parts.push(`Level ${o.minLevel}+`);
  if (o.minShowUpRate != null) parts.push(`${Math.round(o.minShowUpRate * 100)}% show-up`);
  if (o.minGroup > 1) parts.push(`groups of ${o.minGroup}+`);
  return parts.length ? parts.join(', ') : 'Everyone';
}

function OffersView() {
  const [status, setStatus] = useState('active');
  const list = useCursorList((cursor) => api.offers({ status, cursor }), (x) => x, [status]);
  const [target, setTarget] = useState(null);
  const [toast, showToast] = useToast();
  if (list.error?.status === 404) return <NotYet what="Partner offers" />;

  return (
    <>
      <div className="stack">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist" aria-label="Offer status">
            {OFFER_TABS.map(([v, l]) => (
              <button key={v} role="tab" aria-selected={status === v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>
                {l}
              </button>
            ))}
          </div>
          <button className="btn secondary sm" onClick={list.reload} disabled={list.loading}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
        <div className="card">
          <ErrorBox error={list.error} onRetry={list.reload} />
          {list.loading ? (
            <Skeleton h={240} />
          ) : !list.items.length ? (
            list.error ? null : <Empty title="No offers here" body={status === 'active' ? 'Verified venues create perks from the business hub in the app.' : 'Try another tab.'} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Offer</th>
                      <th>Venue</th>
                      <th>Unlocks for</th>
                      <th className="num">Redeemed</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((o) => (
                      <tr key={o.id}>
                        <td style={{ maxWidth: 300 }}>
                          <div className="row wrap" style={{ gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{o.title}</span>
                            {o.label && o.label !== o.title ? <span className="badge peri">{o.label}</span> : null}
                          </div>
                          <div className="caption muted">{[o.window, o.perUserPerWeek ? `${o.perUserPerWeek} per person a week` : null].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{o.venue?.name || 'Unknown venue'}</div>
                          <div className="caption muted row" style={{ gap: 6 }}>
                            {[o.venue?.area, o.business?.name].filter(Boolean).join(' · ')}
                            {o.business?.verificationStatus && o.business.verificationStatus !== 'verified' ? <StatusBadge status={o.business.verificationStatus} /> : null}
                          </div>
                        </td>
                        <td className="soft">{unlockText(o)}</td>
                        <td className="num">
                          {num(o.stats?.week ?? 0)}
                          <span className="caption muted" style={{ display: 'block' }}>
                            {num(o.stats?.total ?? 0)} in total
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={o.status} />
                        </td>
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                            {offerOptions(o.status).map((a) => (
                              <button key={a.value} className={`btn sm${a.danger ? ' danger' : ' secondary'}`} onClick={() => setTarget({ o, status: a.value })}>
                                {a.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="caption muted" style={{ margin: '10px 0 0' }}>
                Redeemed counts verified visits this week, then in total.
              </p>
              <LoadMore list={list} />
            </>
          )}
        </div>
      </div>

      <ActionDialog
        open={!!target}
        title={target ? `${OFFER_ACTIONS[target.status].label} "${target.o.title}"` : ''}
        subtitle={target ? `${target.o.venue?.name || 'Venue'}. ${OFFER_ACTIONS[target.status].description}` : ''}
        options={target ? offerOptions(target.o.status) : []}
        defaultValue={target?.status}
        confirmLabel="Confirm"
        onClose={() => setTarget(null)}
        onSubmit={async ({ action, reason }) => {
          const res = await api.offerStatus(target.o.id, { status: action, reason });
          const next = res?.status || action;
          list.setItems((items) => (status === 'all' ? items.map((x) => (x.id === target.o.id ? { ...x, status: next } : x)) : items.filter((x) => x.id !== target.o.id)));
          showToast(`${target.o.title}: ${OFFER_ACTIONS[next]?.label === 'Resume' ? 'live again' : next}`);
        }}
      />
      {toast}
    </>
  );
}

// ---------------- redemptions ----------------
function RedemptionsView() {
  const list = useCursorList((cursor) => api.redemptions({ cursor }), (x) => x, []);
  if (list.error?.status === 404) return <NotYet what="The redemption log" />;
  return (
    <div className="stack">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span className="caption muted">Codes issued in the last 90 days, newest first. A redeemed code is one verified partner visit.</span>
        <button className="btn secondary sm" onClick={list.reload} disabled={list.loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>
      <div className="card">
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading ? (
          <Skeleton h={240} />
        ) : !list.items.length ? (
          list.error ? null : <Empty title="No redemptions yet" body="Codes appear here when members unlock a perk at a partner venue." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Offer</th>
                    <th>Venue</th>
                    <th>Member</th>
                    <th className="num">Group</th>
                    <th>Issued</th>
                    <th>Redeemed</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ fontWeight: 600, letterSpacing: 1 }}>
                        {r.code}
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.offer?.title || 'Offer'}</div>
                        {r.offer?.label && r.offer.label !== r.offer.title ? <div className="caption muted">{r.offer.label}</div> : null}
                      </td>
                      <td>
                        <div>{r.venue?.name || 'Venue'}</div>
                        {r.venue?.area ? <div className="caption muted">{r.venue.area}</div> : null}
                      </td>
                      <td>
                        {r.user?.id ? (
                          <Link href={`/admin/users/${encodeURIComponent(r.user.id)}`} style={{ fontWeight: 600 }}>
                            {r.user.displayName || String(r.user.id).slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="muted">Unknown</span>
                        )}
                      </td>
                      <td className="num">{r.groupSize ? num(r.groupSize) : <span className="muted">n/a</span>}</td>
                      <td className="soft" style={{ whiteSpace: 'nowrap' }}>
                        {dateTime(r.issuedAt)}
                      </td>
                      <td className="soft" style={{ whiteSpace: 'nowrap' }}>
                        {r.redeemedAt ? dateTime(r.redeemedAt) : <span className="muted">Not yet</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LoadMore list={list} />
          </>
        )}
      </div>
    </div>
  );
}

export default function PartnersPage() {
  const [view, setView] = useState('businesses');
  return (
    <>
      <PageHead eyebrow="Growth" title="Partners">
        <div className="tabs" role="tablist" aria-label="Partner views">
          {VIEWS.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
      </PageHead>
      {view === 'businesses' ? <BusinessesView /> : view === 'offers' ? <OffersView /> : <RedemptionsView />}
    </>
  );
}
