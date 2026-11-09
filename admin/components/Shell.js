'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Icon from './Icon';
import Mascot from './Mascot';
import { ConfigRequired, NoAccess } from './ui';
import { isConfigured } from '@/lib/config';
import { ROLE_LABEL, UNAUTHORIZED_EVENT, can, getSession, logout } from '@/lib/auth';

const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

const NAV = [
  { section: 'Overview' },
  { href: '/admin/dashboard', label: 'Dashboard', icon: 'grid', perm: 'dashboard.view' },
  { section: 'Trust & safety' },
  { href: '/admin/reports', label: 'Reports', icon: 'flag', perm: 'reports.view' },
  { href: '/admin/activities', label: 'Activity review', icon: 'calendar', perm: 'activities.review' },
  { href: '/admin/users', label: 'Users', icon: 'users', perm: 'users.view' },
  { href: '/admin/audit', label: 'Audit log', icon: 'list', perm: 'audit.view' },
  { section: 'Growth' },
  { href: '/admin/partners', label: 'Partners', icon: 'pin', perm: 'partners.manage' },
  { href: '/admin/announcements', label: 'Announcements', icon: 'megaphone', perm: 'announcements.send' },
  { section: 'Business' },
  { href: '/admin/billing', label: 'Billing support', icon: 'receipt', perm: 'billing.view' },
  { href: '/admin/taxonomy', label: 'Taxonomy & quests', icon: 'tag', perm: 'taxonomy.edit' },
];

// Keep a section heading only when at least one of its links is visible to this role.
function visibleNav(role) {
  const out = [];
  let heading = null;
  for (const n of NAV) {
    if (n.section) {
      heading = n;
      continue;
    }
    if (n.perm && !can(role, n.perm)) continue;
    if (heading) {
      out.push(heading);
      heading = null;
    }
    out.push(n);
  }
  return out;
}

// Route guard: first matching prefix decides the permission.
const ROUTE_PERMS = [
  ['/admin/dashboard', 'dashboard.view', 'The KPI dashboard'],
  ['/admin/billing', 'billing.view', 'Billing support'],
  ['/admin/taxonomy', 'taxonomy.edit', 'Taxonomy and quest configuration'],
  ['/admin/partners', 'partners.manage', 'Partner review'],
  ['/admin/announcements', 'announcements.send', 'Announcements'],
  ['/admin/reports', 'reports.view', 'Reports'],
  ['/admin/activities', 'activities.review', 'Activity review'],
  ['/admin/users', 'users.view', 'User records'],
  ['/admin/audit', 'audit.view', 'The audit log'],
];

export default function Shell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!isConfigured) return;
    const s = getSession();
    if (!s) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }
    setSession(s);
  }, [router, pathname]);

  useEffect(() => {
    const onUnauthorized = () => router.replace(`/login?expired=1&returnTo=${encodeURIComponent(window.location.pathname)}`);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  if (!isConfigured) return <ConfigRequired />;

  if (!session) {
    return (
      <div className="login-wrap" aria-busy="true">
        <div className="caption muted">Checking session…</div>
      </div>
    );
  }

  if (!session.role) {
    return (
      <div className="login-wrap">
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="row">
            <Icon name="lock" size={22} />
            <h1 className="h2">No admin role</h1>
          </div>
          <p className="soft">
            You are signed in as <b>{session.phone || session.name}</b>, but your account doesn&apos;t have the <b>admin</b> or <b>moderator</b> role. Ask an admin to grant it (backend: <span className="mono">npm run grant-role</span>), then sign in again.
          </p>
          <button className="btn" onClick={logout}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      </div>
    );
  }

  const items = visibleNav(session.role);
  const guard = ROUTE_PERMS.find(([prefix]) => pathname.startsWith(prefix));
  const allowed = !guard || can(session.role, guard[1]);

  return (
    <SessionContext.Provider value={session}>
      <div className="shell">
        <aside className="sidebar" aria-label="Admin navigation">
          <div className="brand">
            <span className="brand-mark">
              <Mascot size={36} />
            </span>
            <div>
              <div className="h3">IRL Admin</div>
              <div className="caption soft">Operations console</div>
            </div>
          </div>
          <nav className="nav">
            {items.map((n) =>
              n.section ? (
                <div key={n.section} className="eyebrow nav-section" style={{ color: 'var(--ink-soft)' }}>
                  {n.section}
                </div>
              ) : (
                <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'active' : ''} aria-current={pathname.startsWith(n.href) ? 'page' : undefined}>
                  <Icon name={n.icon} />
                  {n.label}
                </Link>
              )
            )}
          </nav>
          <div className="sidebar-foot">
            <div className="row">
              <span className="avatar" style={{ background: 'var(--surface)' }}>
                {(session.name || '?')[0].toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={session.email}>
                  {session.name}
                </div>
                <div className="caption soft">{ROLE_LABEL[session.role]}</div>
              </div>
              <button className="btn sm ghost" onClick={logout} aria-label="Sign out" title="Sign out" style={{ marginLeft: 'auto', padding: '0 8px' }}>
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </aside>
        <main className="main" id="main">
          {allowed ? children : <NoAccess what={guard[2]} role={ROLE_LABEL[session.role]} />}
        </main>
      </div>
    </SessionContext.Provider>
  );
}
