'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { normAudit, normUser } from '@/lib/normalize';
import ActionDialog from '@/components/ActionDialog';
import AuditList from '@/components/AuditList';
import Icon from '@/components/Icon';
import { useSession } from '@/components/Shell';
import { Avatar, Bar, Empty, ErrorBox, LoadMore, PageHead, PriorityBadge, ReasonLabel, Skeleton, StatusBadge, useCursorList, useLoad, useToast } from '@/components/ui';
import { can } from '@/lib/auth';
import { date, dateTime, pct, timeAgo } from '@/lib/format';

const RECENT_KEY = 'irl-admin-recent-users';

function Marker({ ok, icon, title, detail }) {
  const unknown = ok === undefined;
  return (
    <div className="row" style={{ padding: '8px 0' }}>
      <span className="avatar" style={{ width: 34, height: 34, background: ok ? '#d9f2e7' : 'var(--surface-subtle)', color: ok ? 'var(--success)' : 'var(--muted)' }}>
        <Icon name={ok ? icon : unknown ? 'info' : 'x'} size={16} />
      </span>
      <div>
        <div className="label">{title}</div>
        <div className="caption muted">{detail}</div>
      </div>
    </div>
  );
}

function ReportTable({ rows, empty }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/admin/reports/${encodeURIComponent(r.id)}`} className="mono" style={{ fontWeight: 600 }}>
                  {String(r.id).slice(0, 8)}
                </Link>
              </td>
              <td>
                <ReasonLabel reason={r.reason} />
              </td>
              <td>
                <PriorityBadge priority={r.priority} />
              </td>
              <td className="soft">{r.createdAt ? timeAgo(r.createdAt) : '—'}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function UserDetailPage() {
  const { id } = useParams();
  const session = useSession();
  const { data, error, loading, reload, setData } = useLoad(() => api.user(id), [id]);
  const audit = useCursorList((cursor) => api.audit({ entityType: 'user', entityId: id, cursor }), normAudit, [id]);
  const [open, setOpen] = useState(false);
  const [toast, showToast] = useToast();
  const u = normUser(data);

  useEffect(() => {
    if (!u?.id) return;
    try {
      const prev = JSON.parse(window.sessionStorage.getItem(RECENT_KEY)) || [];
      const next = [{ id: u.id, name: u.name }, ...prev.filter((x) => x.id !== u.id)].slice(0, 8);
      window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [u?.id, u?.name]);

  if (loading && !data) return <Skeleton h={420} />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!u) return null;

  const deleted = u.status === 'deleted';
  const allowed = can(session?.role, 'users.status');
  const options = [
    { value: 'limited', label: 'Limit', description: 'Restrict joining and hosting; chat only in accepted plans.', disabled: u.status === 'limited', disabledReason: 'Already limited.' },
    { value: 'suspended', label: 'Suspend', description: 'Social features blocked; safety tools and appeal remain.', danger: true, disabled: u.status === 'suspended', disabledReason: 'Already suspended.' },
    { value: 'active', label: 'Restore to active', description: 'Lift limits or suspension.', disabled: u.status === 'active', disabledReason: 'Already active.' },
  ];

  return (
    <>
      <Link href="/admin/users" className="btn sm ghost" style={{ paddingLeft: 0, marginBottom: 6 }}>
        <Icon name="back" size={14} /> Users
      </Link>
      <PageHead
        eyebrow={[u.area, u.city, u.createdAt ? `joined ${date(u.createdAt)}` : null].filter(Boolean).join(' · ') || 'User'}
        title={
          <span className="row" style={{ gap: 14 }}>
            <Avatar name={u.name} id={u.id} lg />
            {u.name}
          </span>
        }
      >
        <StatusBadge status={u.status} />
        {allowed ? (
          <button className="btn" onClick={() => setOpen(true)} disabled={deleted}>
            <Icon name="shield" size={16} /> Change status
          </button>
        ) : null}
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />

      {deleted ? (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          <Icon name="info" /> Account deleted{u.deletedAt ? ` ${timeAgo(u.deletedAt)}` : ''}. Data is retained only as the retention schedule requires; status changes are locked.
        </div>
      ) : null}
      {u.statusReason ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="info" /> Status reason: {u.statusReason}
          {u.statusUntil ? ` · until ${dateTime(u.statusUntil)}` : ''}
        </div>
      ) : null}

      <div className="cols-2">
        <div className="stack">
          <div className="cols-even">
            <div className="card">
              <h2 className="h3">Verification markers</h2>
              <Marker ok={u.phoneVerified} icon="phone" title="Phone verified (OTP)" detail={u.phone || 'masked'} />
              <Marker
                ok={u.ageVerified}
                icon="check"
                title="18+ attestation"
                detail={u.ageVerified ? [u.ageMethod?.replace(/_/g, ' '), u.ageVerifiedAt ? date(u.ageVerifiedAt) : null].filter(Boolean).join(' · ') || 'attested' : u.ageVerified === false ? 'Not attested — cannot join or publish' : 'Unknown'}
              />
              <Marker ok={u.idVerified} icon="id" title="Higher-trust verification" detail={u.idVerified ? 'Passed' : u.idVerified === false ? 'Not completed (optional)' : 'Unknown'} />
            </div>
            <div className="card">
              <h2 className="h3">Reliability</h2>
              <div style={{ fontSize: 40, fontWeight: 700, lineHeight: '46px', marginTop: 6 }}>{u.reliability != null ? pct(u.reliability) : '—'}</div>
              <Bar value={u.reliability} color={u.reliability != null && u.reliability < 0.8 ? 'var(--danger)' : 'var(--ink)'} />
              <div className="row wrap caption soft" style={{ gap: 12, marginTop: 10 }}>
                {u.completed != null ? <span>{u.completed} completed</span> : null}
                {u.hosted != null ? <span>{u.hosted} hosted</span> : null}
                {u.noShows != null ? <span>{u.noShows} no-shows</span> : null}
                {u.lateCancels != null ? <span>{u.lateCancels} late cancels</span> : null}
              </div>
              {u.riskScore != null ? (
                <>
                  <div className="divider" />
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="label">Risk score</span>
                    <span className="label">{Math.round(u.riskScore * 100)}/100</span>
                  </div>
                  <Bar value={u.riskScore} color={u.riskScore > 0.6 ? 'var(--danger)' : 'var(--orange)'} />
                  <p className="caption muted" style={{ marginBottom: 0 }}>
                    Signal only — never an automatic sanction.
                  </p>
                </>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="h2">Reports against</h2>
              <span className="badge">{u.reportsAgainst.length}</span>
            </div>
            <ReportTable rows={u.reportsAgainst} empty="No reports against this user" />
          </div>
          <div className="card">
            <div className="card-head">
              <h2 className="h2">Reports filed</h2>
              <span className="badge">{u.reportsBy.length}</span>
            </div>
            <ReportTable rows={u.reportsBy} empty="This user hasn't filed reports" />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2 className="h3">Account</h2>
            <dl style={{ margin: '10px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
              <dt className="caption muted">User id</dt>
              <dd className="mono" style={{ margin: 0, wordBreak: 'break-all' }}>
                {u.id}
              </dd>
              <dt className="caption muted">Phone</dt>
              <dd style={{ margin: 0 }}>{u.phone || '—'}</dd>
              <dt className="caption muted">Last active</dt>
              <dd style={{ margin: 0 }}>{u.lastActiveAt ? dateTime(u.lastActiveAt) : '—'}</dd>
              <dt className="caption muted">Plan</dt>
              <dd style={{ margin: 0 }}>{u.subscription ? `${u.subscription.tier || u.subscription.productId || 'paid'} · ${String(u.subscription.status).replace(/_/g, ' ')}` : 'Free'}</dd>
            </dl>
          </div>
          <div className="card">
            <div className="card-head">
              <h2 className="h2">Audit trail</h2>
              <button className="btn sm ghost" onClick={audit.reload} aria-label="Refresh audit">
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <ErrorBox error={audit.error} onRetry={audit.reload} />
            {audit.loading ? <Skeleton h={80} /> : <AuditList entries={audit.items} empty="No account actions yet." />}
            <LoadMore list={audit} />
          </div>
        </div>
      </div>

      <ActionDialog
        open={open}
        title={`Change status · ${u.name}`}
        subtitle={`Currently ${u.status}. The user is notified with the policy reason and how to appeal.`}
        options={options}
        confirmLabel="Apply"
        onClose={() => setOpen(false)}
        onSubmit={async ({ action, reason }) => {
          const res = await api.setUserStatus(id, { status: action, reason });
          if (res && typeof res === 'object' && (res.id || res.user)) setData(res.user || res);
          else await reload();
          audit.reload();
          showToast('Status updated');
        }}
      />
      {toast}
    </>
  );
}
