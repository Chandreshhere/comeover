'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';
import { Avatar, PageHead } from '@/components/ui';

const RECENT_KEY = 'irl-admin-recent-users';

// The admin API exposes GET /admin/users/{id} only (no directory listing), so
// moderators open users from reports/activities or look them up by id here.
export default function UsersPage() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    try {
      setRecent(JSON.parse(window.sessionStorage.getItem(RECENT_KEY)) || []);
    } catch {
      setRecent([]);
    }
  }, []);

  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());

  return (
    <>
      <PageHead eyebrow="Trust & safety" title="Users" />
      <div className="cols-2">
        <div className="card">
          <h2 className="h2">Open a user record</h2>
          <p className="soft">Paste a user id (UUID) from a report, audit entry or support ticket.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) router.push(`/admin/users/${encodeURIComponent(id.trim())}`);
            }}
          >
            <div className="row" style={{ flex: 1, background: 'var(--surface)', borderRadius: 999, border: '1.2px solid var(--border)', padding: '0 14px', height: 44 }}>
              <Icon name="search" size={16} />
              <input
                aria-label="User id"
                className="mono"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={id}
                onChange={(e) => setId(e.target.value)}
                style={{ border: 'none', outline: 'none', flex: 1, background: 'transparent' }}
              />
            </div>
            <button className="btn" type="submit" disabled={!valid}>
              Open
            </button>
          </form>
          {id && !valid ? <p className="caption" style={{ color: 'var(--danger)' }}>That doesn’t look like a user id.</p> : null}
        </div>
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
            <p className="muted">Users you open will appear here.</p>
          )}
        </div>
      </div>
      <p className="caption muted" style={{ marginTop: 12 }}>
        Phone numbers are masked. Full contact details are only available through a logged break-glass request on the backend.
      </p>
    </>
  );
}
