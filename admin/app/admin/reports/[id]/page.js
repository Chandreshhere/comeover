'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { normAudit, normReport } from '@/lib/normalize';
import ActionDialog from '@/components/ActionDialog';
import AuditList from '@/components/AuditList';
import Icon from '@/components/Icon';
import SlaTimer from '@/components/SlaTimer';
import { useSession } from '@/components/Shell';
import { Avatar, Bar, ErrorBox, LoadMore, PageHead, PriorityBadge, ReasonLabel, Skeleton, StatusBadge, useCursorList, useLoad, useToast } from '@/components/ui';
import { can } from '@/lib/auth';
import { dateTime, pct, timeAgo } from '@/lib/format';

const ENFORCEMENT = [
  { value: 'warn', label: 'Warn', description: 'Send a policy reminder. No feature limits.' },
  { value: 'remove_content', label: 'Remove content', description: 'Remove the reported plan or message.' },
  { value: 'limit', label: 'Limit account', description: 'Restrict joining/hosting for the chosen duration.', duration: true },
  { value: 'suspend', label: 'Suspend account', description: 'Blocks social features; safety tools and appeal remain.', danger: true, duration: true },
  { value: 'dismiss', label: 'Dismiss', description: 'No violation found. Reporter is told the report was reviewed.' },
];

export default function ReportReviewPage() {
  const { id } = useParams();
  const session = useSession();
  const { data, error, loading, reload, setData } = useLoad(() => api.report(id), [id]);
  const audit = useCursorList((cursor) => api.audit({ entityType: 'report', entityId: id, cursor }), normAudit, [id]);
  const [dialog, setDialog] = useState(null);
  const [toast, showToast] = useToast();

  if (loading && !data) return <Skeleton h={420} />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const r = normReport(data);
  if (!r) return null;

  const resolved = ['actioned', 'dismissed'].includes(r.status);
  const u = r.reportedProfile;
  const after = async (res, msg) => {
    if (res && typeof res === 'object' && (res.id || res.report)) setData(res.report || res);
    else await reload();
    audit.reload();
    showToast(msg);
  };

  return (
    <>
      <Link href="/admin/reports" className="btn sm ghost" style={{ paddingLeft: 0, marginBottom: 6 }}>
        <Icon name="back" size={14} /> Reports
      </Link>
      <PageHead eyebrow={`Report · filed ${r.createdAt ? timeAgo(r.createdAt) : 'n/a'}`} title={<span className="mono" style={{ fontSize: 26 }}>{String(r.id).slice(0, 8)}</span>}>
        <StatusBadge status={r.status} />
        <PriorityBadge priority={r.priority} />
        {r.status !== 'appealed' && r.slaDueAt ? <SlaTimer dueAt={r.slaDueAt} resolved={resolved} /> : null}
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />

      <div className="cols-2">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2 className="h2">
                <ReasonLabel reason={r.reason} />
              </h2>
              <span className="caption muted">{dateTime(r.createdAt)}</span>
            </div>
            {r.details ? <p style={{ margin: 0, fontSize: 15 }}>“{r.details}”</p> : <p className="muted" style={{ margin: 0 }}>No details provided.</p>}
            <div className="divider" />
            <div className="row wrap" style={{ gap: 24 }}>
              <div>
                <div className="eyebrow">Reporter</div>
                {r.reporter?.id ? (
                  <Link href={`/admin/users/${encodeURIComponent(r.reporter.id)}`} className="label">
                    {r.reporter.name}
                  </Link>
                ) : (
                  <span className="label">n/a</span>
                )}
                <div className="caption muted">identity hidden from reported user</div>
              </div>
              {r.activity ? (
                <div>
                  <div className="eyebrow">Plan context</div>
                  <div className="label">{r.activity.title || String(r.activity.id).slice(0, 8)}</div>
                  <div className="caption muted">{[r.activity.venueType, r.activity.area].filter(Boolean).join(' · ') || 'n/a'}</div>
                </div>
              ) : null}
              {r.assignee ? (
                <div>
                  <div className="eyebrow">Assignee</div>
                  <div className="label">{r.assignee}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="h2">Evidence</h2>
              <span className="caption muted">Access is logged by the API</span>
            </div>
            {r.evidence.length ? (
              <div className="stack" style={{ gap: 10 }}>
                {r.evidence.map((ev) => (
                  <div key={ev.id} className="evidence open">
                    <div className="row">
                      <span className="badge">{ev.type}</span>
                      <span className="label" style={{ wordBreak: 'break-all' }}>
                        {ev.label}
                      </span>
                      <span className="spacer" />
                      {ev.url ? (
                        <a className="btn sm secondary" href={ev.url} target="_blank" rel="noopener noreferrer">
                          <Icon name="eye" size={14} /> Open
                        </a>
                      ) : null}
                    </div>
                    {ev.content ? <p style={{ margin: '10px 0 0' }}>{ev.content}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No evidence attached.
              </p>
            )}
          </div>

          {r.actions.length ? (
            <div className="card">
              <h2 className="h2" style={{ marginBottom: 8 }}>
                Actions taken
              </h2>
              {r.actions.map((a, i) => (
                <div key={a.id || i} className="row" style={{ padding: '6px 0', alignItems: 'flex-start' }}>
                  <span className="badge ink">{String(a.action).replace(/_/g, ' ')}</span>
                  <div style={{ flex: 1 }}>
                    <div>{a.notes || 'n/a'}</div>
                    <div className="caption muted">
                      {a.createdAt ? timeAgo(a.createdAt) : ''} {a.by ? `· ${a.by}` : ''} {a.durationDays ? `· ${a.durationDays} days` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {r.appeal ? (
            <div className="card" style={{ background: 'var(--pink-soft)', boxShadow: 'none' }}>
              <div className="card-head">
                <h2 className="h2">Appeal</h2>
                <StatusBadge status={r.appeal.status} />
              </div>
              {r.appeal.statement ? <p style={{ margin: 0 }}>“{r.appeal.statement}”</p> : null}
              <p className="caption soft" style={{ marginTop: 8 }}>
                {r.appeal.createdAt ? `Submitted ${timeAgo(r.appeal.createdAt)}` : ''}
                {r.appeal.decidedBy ? ` · decided by ${r.appeal.decidedBy}` : ''}
              </p>
              {r.appeal.status === 'open' || r.appeal.status === 'pending' ? (
                can(session?.role, 'appeals.decide') ? (
                  <button className="btn" style={{ marginTop: 8 }} onClick={() => setDialog('appeal')}>
                    Decide appeal
                  </button>
                ) : null
              ) : null}
            </div>
          ) : null}

          <div className="card">
            <div className="card-head">
              <h2 className="h2">Audit trail</h2>
              <button className="btn sm ghost" onClick={audit.reload}>
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <ErrorBox error={audit.error} onRetry={audit.reload} />
            {audit.loading ? <Skeleton h={80} /> : <AuditList entries={audit.items} empty="No actions on this report yet." />}
            <LoadMore list={audit} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="eyebrow">Reported user</div>
            {r.reported?.id ? (
              <div className="row" style={{ marginTop: 10 }}>
                <Avatar name={u?.name || r.reported.name} id={r.reported.id} lg />
                <div>
                  <Link href={`/admin/users/${encodeURIComponent(r.reported.id)}`} className="h3">
                    {u?.name || r.reported.name}
                  </Link>
                  <div className="caption muted mono">{String(r.reported.id).slice(0, 8)}</div>
                  <div style={{ marginTop: 4 }}>
                    <StatusBadge status={u?.status || r.reported.status} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">No user attached to this report.</p>
            )}
            {u ? (
              <>
                <div className="divider" />
                {u.reliability != null ? (
                  <div style={{ marginBottom: 10 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="label">Show-up reliability</span>
                      <span className="label">{pct(u.reliability)}</span>
                    </div>
                    <Bar value={u.reliability} color={u.reliability < 0.8 ? 'var(--danger)' : 'var(--ink)'} />
                  </div>
                ) : null}
                <div className="row wrap caption soft" style={{ gap: 12 }}>
                  {u.completed != null ? <span>{u.completed} completed</span> : null}
                  {u.noShows != null ? <span>{u.noShows} no-shows</span> : null}
                  {u.lateCancels != null ? <span>{u.lateCancels} late cancels</span> : null}
                  {u.createdAt ? <span>joined {timeAgo(u.createdAt)}</span> : null}
                </div>
              </>
            ) : null}
            {r.priorReports.length ? (
              <>
                <div className="divider" />
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Other reports against this user
                </div>
                {r.priorReports.map((p) => (
                  <Link key={p.id} href={`/admin/reports/${encodeURIComponent(p.id)}`} className="row" style={{ padding: '6px 0' }}>
                    <span className="mono">{String(p.id).slice(0, 8)}</span>
                    <span className="soft">
                      <ReasonLabel reason={p.reason} />
                    </span>
                    <span className="spacer" />
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </>
            ) : null}
          </div>

          <div className="card">
            <h2 className="h2">Decision</h2>
            <p className="soft" style={{ marginTop: 4 }}>
              Pick the least severe action that resolves the risk. Every decision needs a written reason and can be appealed.
            </p>
            {resolved ? (
              <div className="notice" style={{ marginBottom: 12 }}>
                <Icon name="check" /> Resolved {r.resolvedAt ? timeAgo(r.resolvedAt) : ''}.
              </div>
            ) : null}
            <button className="btn" style={{ width: '100%' }} onClick={() => setDialog('enforce')} disabled={!can(session?.role, 'reports.act') || r.status === 'appealed'}>
              <Icon name="shield" size={16} /> {resolved ? 'Take further action' : 'Take action'}
            </button>
            {r.status === 'appealed' ? <p className="caption muted">Decide the open appeal first.</p> : null}
          </div>
        </div>
      </div>

      <ActionDialog
        open={dialog === 'enforce'}
        title="Take action on report"
        subtitle={r.reported?.name ? `Against ${u?.name || r.reported.name}` : undefined}
        options={ENFORCEMENT}
        withDuration
        defaultValue={r.priority === 'high' || r.priority === 'urgent' ? 'limit' : 'warn'}
        confirmLabel="Apply"
        onClose={() => setDialog(null)}
        onSubmit={async ({ action, reason, durationDays }) => {
          const res = await api.reportAction(id, { action, reason, durationDays });
          await after(res, 'Decision saved');
        }}
      />
      <ActionDialog
        open={dialog === 'appeal'}
        title="Decide appeal"
        subtitle="Overturning lifts the enforcement and notifies both parties."
        options={[
          { value: 'uphold', label: 'Uphold original decision', description: 'Enforcement stays in place.' },
          { value: 'overturn', label: 'Overturn', description: 'Lift the enforcement and close the report.', danger: true },
        ]}
        confirmLabel="Decide"
        onClose={() => setDialog(null)}
        onSubmit={async ({ action, reason }) => {
          const res = await api.reportAppeal(id, { decision: action, reason });
          await after(res, 'Appeal decision saved');
        }}
      />
      {toast}
    </>
  );
}
