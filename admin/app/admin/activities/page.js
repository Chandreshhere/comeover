'use client';
import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { normActivity } from '@/lib/normalize';
import ActionDialog from '@/components/ActionDialog';
import Icon from '@/components/Icon';
import { RiskMeter } from '@/components/charts';
import { Empty, ErrorBox, LoadMore, PageHead, Skeleton, StatusBadge, useCursorList, useToast } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';

const FLAG_META = {
  spam: ['Spam', 'bad'],
  undisclosed_promo: ['Undisclosed promo', 'bad'],
  duplicate: ['Duplicate', 'lav'],
  location_risk: ['Location risk', 'bad'],
  private_venue: ['Private venue', 'bad'],
  venue_changed: ['Venue changed', 'warn'],
  pricing: ['Paid entry', 'warn'],
  over_capacity_limit: ['Over capacity limit', 'warn'],
  elevated_category: ['Elevated category', 'warn'],
  new_host: ['New host', 'peri'],
  reported: ['Reported', 'pink'],
  fraud: ['Fraud', 'bad'],
};

function Flag({ f }) {
  const [label, tone] = FLAG_META[f] || [String(f).replace(/_/g, ' '), ''];
  return <span className={`badge ${tone}`}>{label}</span>;
}

function ActivityCard({ a, onDecide }) {
  const decided = ['approved', 'removed', 'moderated', 'cancelled'].includes(a.status);
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
            {a.flags.map((f) => (
              <Flag key={f} f={f} />
            ))}
            {a.reports ? <span className="badge pink">{a.reports} report{a.reports > 1 ? 's' : ''}</span> : null}
            {a.sponsored ? <span className="badge warn">sponsored</span> : null}
          </div>
          <h2 className="h2">{a.title}</h2>
          <div className="soft" style={{ marginTop: 2 }}>
            {a.host?.id ? (
              <>
                Host{' '}
                <Link href={`/admin/users/${encodeURIComponent(a.host.id)}`} style={{ fontWeight: 600, textDecoration: 'underline' }}>
                  {a.host.name}
                </Link>
              </>
            ) : (
              'Host unknown'
            )}
            {[a.category, a.area, a.startsAt ? `starts ${dateTime(a.startsAt)}` : null, a.capacity != null ? `${a.joined ?? '?'}/${a.capacity} joined` : null]
              .filter(Boolean)
              .map((x) => ` · ${x}`)
              .join('')}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {a.riskScore != null ? (
            <>
              <div className="eyebrow">Risk</div>
              <RiskMeter value={a.riskScore} />
            </>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <StatusBadge status={a.status} />
          </div>
        </div>
      </div>

      {a.description ? <p className="soft" style={{ marginBottom: 0 }}>{a.description}</p> : null}

      <div className="cols-even" style={{ marginTop: 14 }}>
        <div className={`notice${a.publicVenue === false ? ' bad' : ''}`}>
          <Icon name="pin" />
          <div>
            <div className="label">{a.venueName || 'Venue not set'}</div>
            <div className="caption">
              {a.venueType || 'type unknown'}
              {a.publicVenue === false ? ' · NOT a public venue — plans must meet in public places' : a.publicVenue ? ' · public venue' : ''}
            </div>
          </div>
        </div>
        {a.signals.length || a.moderationNote ? (
          <div className="notice" style={{ background: 'var(--surface-subtle)' }}>
            <Icon name="info" />
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {a.signals.map((s) => (
                <li key={s} className="caption" style={{ fontSize: 12 }}>
                  {s}
                </li>
              ))}
              {a.moderationNote ? (
                <li className="caption" style={{ fontSize: 12 }}>
                  Note: {a.moderationNote}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      {a.duplicateOf ? (
        <div className="notice" style={{ marginTop: 12, background: 'var(--lavender)' }}>
          <Icon name="copyDup" />
          Possible duplicate of <span className="mono">{String(a.duplicateOf).slice(0, 8)}</span>
          {a.duplicateTitle ? ` “${a.duplicateTitle}”` : ''}
          {a.similarity != null ? ` · similarity ${Math.round(a.similarity * 100)}%` : ''}
        </div>
      ) : null}

      <div className="row wrap" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <span className="caption muted mono">
          {String(a.id).slice(0, 8)}
          {a.createdAt ? ` · created ${timeAgo(a.createdAt)}` : ''}
        </span>
        {!decided ? (
          <div className="row">
            <button className="btn sm danger" onClick={() => onDecide(a, 'remove')}>
              Remove
            </button>
            <button className="btn sm" onClick={() => onDecide(a, 'approve')}>
              <Icon name="check" size={14} /> Approve
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ActivitiesPage() {
  const [queue, setQueue] = useState('flagged');
  const list = useCursorList((cursor) => api.activities({ queue, cursor }), normActivity, [queue]);
  const [target, setTarget] = useState(null);
  const [toast, showToast] = useToast();

  return (
    <>
      <PageHead eyebrow="Trust & safety" title="Activity review">
        <div className="tabs" role="tablist" aria-label="Queue">
          {[
            ['flagged', 'Flagged'],
            ['recent', 'Recent'],
          ].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={queue === v} className={queue === v ? 'on' : ''} onClick={() => setQueue(v)}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn secondary sm" onClick={list.reload} disabled={list.loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </PageHead>

      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading ? (
        <Skeleton h={300} />
      ) : !list.items.length ? (
        list.error ? null : (
          <div className="card">
            <Empty title={queue === 'flagged' ? 'Nothing flagged' : 'No recent plans'} body={queue === 'flagged' ? 'Flagged plans appear here, highest risk first.' : 'Newly published plans will appear here.'} />
          </div>
        )
      ) : (
        <div className="stack">
          {list.items.map((a) => (
            <ActivityCard key={a.id} a={a} onDecide={(act, decision) => setTarget({ a: act, decision })} />
          ))}
          <LoadMore list={list} />
        </div>
      )}

      <ActionDialog
        open={!!target}
        title={target ? `${target.decision === 'approve' ? 'Approve' : 'Remove'} “${target.a.title}”` : ''}
        subtitle={target?.decision === 'remove' ? 'The host and accepted participants are notified; the group chat stays readable for safety.' : 'Clears the flags and keeps the plan discoverable.'}
        options={target ? [{ value: target.decision, label: target.decision, danger: target.decision === 'remove' }] : []}
        defaultValue={target?.decision}
        confirmLabel="Confirm"
        onClose={() => setTarget(null)}
        onSubmit={async ({ action, reason }) => {
          const res = await api.activityDecision(target.a.id, { decision: action, reason });
          const status = res && typeof res === 'object' ? res.status || res.moderationStatus || res.moderation_status : null;
          list.setItems((items) =>
            queue === 'flagged' ? items.filter((x) => x.id !== target.a.id) : items.map((x) => (x.id === target.a.id ? { ...x, status: status || (action === 'approve' ? 'approved' : 'removed') } : x))
          );
          showToast(action === 'approve' ? 'Plan approved' : 'Plan removed');
        }}
      />
      {toast}
    </>
  );
}
