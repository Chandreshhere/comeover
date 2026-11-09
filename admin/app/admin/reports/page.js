'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { normReport } from '@/lib/normalize';
import SlaTimer from '@/components/SlaTimer';
import { Empty, ErrorBox, LoadMore, PageHead, PriorityBadge, ReasonLabel, Skeleton, StatusBadge, UserLink, useCursorList } from '@/components/ui';
import Icon from '@/components/Icon';
import { timeAgo } from '@/lib/format';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'appealed', label: 'Appealed' },
  { value: 'actioned', label: 'Actioned' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: '', label: 'All' },
];

export default function ReportsPage() {
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const list = useCursorList((cursor) => api.reports({ status, cursor }), normReport, [status]);
  const open = (id) => router.push(`/admin/reports/${encodeURIComponent(id)}`);

  return (
    <>
      <PageHead eyebrow="Trust & safety" title="Reports">
        <button className="btn secondary sm" onClick={list.reload} disabled={list.loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </PageHead>

      <div className="row wrap" style={{ marginBottom: 16 }} role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <button key={f.label} role="tab" aria-selected={status === f.value} className={`chip${status === f.value ? ' on' : ''}`} onClick={() => setStatus(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <ErrorBox error={list.error} onRetry={list.reload} />
      <div className="card">
        {list.loading ? (
          <Skeleton h={260} />
        ) : list.items.length === 0 ? (
          list.error ? null : <Empty title="Queue is clear" body="No reports with this status." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Reason</th>
                  <th>Priority</th>
                  <th>Reported user</th>
                  <th>Reporter</th>
                  <th>Filed</th>
                  <th>SLA</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((r) => (
                  <tr key={r.id} className="click" tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => e.key === 'Enter' && open(r.id)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {String(r.id).slice(0, 8)}
                      </span>
                      {r.activity?.title ? <div className="caption muted">{r.activity.title}</div> : null}
                    </td>
                    <td>
                      <ReasonLabel reason={r.reason} />
                    </td>
                    <td>
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td>
                      <UserLink user={r.reported} />
                    </td>
                    <td className="soft">{r.reporter?.name || 'n/a'}</td>
                    <td className="soft">{r.createdAt ? timeAgo(r.createdAt) : 'n/a'}</td>
                    <td>
                      {r.status === 'appealed' ? <span className="badge pink">appeal</span> : r.slaDueAt ? <SlaTimer dueAt={r.slaDueAt} resolved={['actioned', 'dismissed'].includes(r.status)} /> : 'n/a'}
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.assignee ? <div className="caption muted">{r.assignee}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore list={list} />
      </div>
      <p className="caption muted" style={{ marginTop: 12 }}>
        Review SLA by priority: urgent 1h · high 4h · normal 24h · low 72h. Reporter identities are never shown to the reported user.
      </p>
    </>
  );
}
