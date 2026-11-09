'use client';
// Member directory (admin role): GET /admin/users?q=&status=&sort= with masked phones.
// Moderators keep the id lookup and the recently viewed list; every record opens the
// existing detail page (/admin/users/{id}), which is audited on view.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Icon from '@/components/Icon';
import { useSession } from '@/components/Shell';
import { Avatar, Empty, ErrorBox, LoadMore, PageHead, Skeleton, StatusBadge, useCursorList } from '@/components/ui';
import { can } from '@/lib/auth';
import { date, num, timeAgo } from '@/lib/format';

const RECENT_KEY = 'irl-admin-recent-users';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = [
  ['all', 'All'],
  ['active', 'Active'],
  ['limited', 'Limited'],
  ['suspended', 'Suspended'],
  ['deleted', 'Deleted'],
];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function IdLookup() {
  const router = useRouter();
  const [id, setId] = useState('');
  const valid = UUID.test(id.trim());
  return (
    <div className="card">
      <h2 className="h3">Open a user record</h2>
      <p className="caption soft" style={{ margin: '4px 0 12px' }}>
        Paste a user id from a report, audit entry or support ticket.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) router.push(`/admin/users/${encodeURIComponent(id.trim())}`);
        }}
      >
        <div className="row" style={{ flex: 1, background: 'var(--surface)', borderRadius: 999, border: '1.2px solid var(--border)', padding: '0 14px', height: 44 }}>
          <Icon name="id" size={16} />
          <input
            aria-label="User id"
            className="mono"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={id}
            onChange={(e) => setId(e.target.value)}
            style={{ border: 'none', outline: 'none', flex: 1, minWidth: 0, background: 'transparent' }}
          />
        </div>
        <button className="btn" type="submit" disabled={!valid}>
          Open
        </button>
      </form>
      {id && !valid ? (
        <p className="caption" style={{ color: 'var(--danger)', marginBottom: 0 }}>
          That doesn’t look like a user id.
        </p>
      ) : null}
    </div>
  );
}

function Recent() {
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    try {
      setRecent(JSON.parse(window.sessionStorage.getItem(RECENT_KEY)) || []);
    } catch {
      setRecent([]);
    }
  }, []);
  return (
    <div className="card">
      <h2 className="h3">Recently viewed (this tab)</h2>
      {recent.length ? (
        recent.map((u) => (
          <Link key={u.id} href={`/admin/users/${encodeURIComponent(u.id)}`} className="row" style={{ padding: '8px 0' }}>
            <Avatar name={u.name} id={u.id} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{u.name}</span>
              <span className="caption muted mono">{String(u.id).slice(0, 8)}</span>
            </span>
          </Link>
        ))
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Users you open will appear here.
        </p>
      )}
    </div>
  );
}

function Directory() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('new');
  const [counts, setCounts] = useState(null);
  const list = useCursorList(
    async (cursor) => {
      const res = await api.users({ q: dq || undefined, status, sort, cursor });
      if (res && res.counts) setCounts(res.counts);
      return res;
    },
    (x) => x,
    [dq, status, sort]
  );

  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="row" style={{ flex: '1 1 280px', background: 'var(--surface)', borderRadius: 999, border: '1.2px solid var(--border)', padding: '0 14px', height: 44 }}>
          <Icon name="search" size={16} />
          <input
            type="search"
            aria-label="Search members"
            placeholder="Name, user id, or last 4 digits of a phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: 'none', outline: 'none', flex: 1, minWidth: 0, background: 'transparent' }}
          />
        </div>
        <div className="tabs" role="tablist" aria-label="Status">
          {STATUSES.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>
              {l}
            </button>
          ))}
        </div>
        <select className="select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto', minHeight: 42, borderRadius: 999 }}>
          <option value="new">Newest first</option>
          <option value="active">Recently active</option>
        </select>
      </div>

      {counts ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="badge">{num(counts.total)} members</span>
          <span className="badge peri">{num(counts.active7d)} active in the last 7 days</span>
          <span className="badge bad">{num(counts.suspended)} suspended</span>
        </div>
      ) : null}

      <div className="card">
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading ? (
          <Skeleton h={320} />
        ) : !list.items.length ? (
          list.error ? null : <Empty title={dq ? 'No matches' : 'No members here'} body={dq ? 'Try a different name, a full user id, or the last 4 digits of a phone number.' : 'Try another status.'} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Phone</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th className="num">Level</th>
                    <th className="num">Reports</th>
                    <th>Joined</th>
                    <th>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((u) => (
                    <tr key={u.id} className="click" onClick={() => router.push(`/admin/users/${encodeURIComponent(u.id)}`)}>
                      <td>
                        <Link href={`/admin/users/${encodeURIComponent(u.id)}`} className="row" style={{ gap: 8 }} onClick={(e) => e.stopPropagation()}>
                          <Avatar name={u.displayName || '?'} id={u.id} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 600, display: 'block' }}>
                              {u.displayName || <span className="muted">No profile yet</span>}
                              {(u.roles || []).length ? <span className="badge lav" style={{ marginLeft: 6 }}>{u.roles.join(', ')}</span> : null}
                            </span>
                            <span className="caption muted mono">{String(u.id).slice(0, 8)}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="mono soft">{u.phoneMasked || 'Hidden'}</td>
                      <td className="soft">{u.area || <span className="muted">Not set</span>}</td>
                      <td>
                        <StatusBadge status={u.status} />
                      </td>
                      <td className="num">
                        L{u.level ?? 1}
                        <span className="caption muted" style={{ display: 'block' }}>
                          {num(u.xp ?? 0)} XP
                        </span>
                      </td>
                      <td className="num">{u.reportsAgainst ? <span className="badge warn">{num(u.reportsAgainst)}</span> : <span className="muted">0</span>}</td>
                      <td className="soft">{u.createdAt ? date(u.createdAt) : 'Unknown'}</td>
                      <td className="soft">{u.lastActiveAt ? timeAgo(u.lastActiveAt) : <span className="muted">Never</span>}</td>
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

export default function UsersPage() {
  const session = useSession();
  const directory = can(session?.role, 'users.directory');
  return (
    <>
      <PageHead eyebrow="Trust & safety" title="Users" />
      {directory ? <Directory /> : null}
      {!directory ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="info" />
          <div>Searching the full member list needs the admin role. You can still open any record by its id.</div>
        </div>
      ) : null}
      <div className="cols-even" style={{ marginTop: directory ? 16 : 0 }}>
        <IdLookup />
        <Recent />
      </div>
      <p className="caption muted" style={{ marginTop: 12 }}>
        Phone numbers are always masked. Full contact details are only available through a logged break-glass request on the backend.
      </p>
    </>
  );
}
