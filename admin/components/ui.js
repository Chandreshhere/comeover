'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import { initials, REASONS } from '@/lib/format';
import { cursorOf, listOf } from '@/lib/normalize';
import { ENV_VARS } from '@/lib/config';

const STATUS_TONE = {
  active: 'ok',
  limited: 'warn',
  suspended: 'bad',
  deleted: 'lav',
  open: 'peri',
  reviewing: 'warn',
  actioned: 'ok',
  dismissed: '',
  appealed: 'pink',
  pending: 'peri',
  flagged: 'warn',
  approved: 'ok',
  removed: 'bad',
  moderated: 'bad',
  cancelled: '',
  completed: 'ok',
  grace_period: 'warn',
  refunded: 'pink',
  expired: '',
  paused: 'warn',
  paused_review: 'warn',
  upheld: 'ok',
  overturned: 'pink',
};

export function StatusBadge({ status }) {
  if (!status) return <span className="badge">—</span>;
  const tone = STATUS_TONE[status] ?? '';
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const tone = priority === 'urgent' || priority === 'high' ? 'bad' : priority === 'normal' || priority === 'medium' ? 'warn' : '';
  return <span className={`badge ${tone}`}>{priority || '—'}</span>;
}

export function ReasonLabel({ reason }) {
  return <span>{REASONS[reason] || String(reason || 'other').replace(/_/g, ' ')}</span>;
}

const AV_BG = ['#9CB9FF', '#F0A34B', '#E6A2F2', '#E5E3FA', '#BFE8D6'];
export function Avatar({ name = '', id = '', lg = false }) {
  const h = [...String(id || name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className={`avatar${lg ? ' lg' : ''}`} style={{ background: AV_BG[h % AV_BG.length] }} aria-hidden="true">
      {initials(name) || '?'}
    </span>
  );
}

export function UserLink({ user }) {
  if (!user?.id) return <span className="muted">—</span>;
  return (
    <Link href={`/admin/users/${encodeURIComponent(user.id)}`} className="row" style={{ gap: 8 }} onClick={(e) => e.stopPropagation()}>
      <Avatar name={user.name} id={user.id} />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 600, display: 'block' }}>{user.name}</span>
        <span className="caption muted mono">{String(user.id).slice(0, 8)}</span>
      </span>
    </Link>
  );
}

export function Bar({ value, color }) {
  if (value == null || Number.isNaN(value)) return <div className="bar" />;
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Skeleton({ h = 120 }) {
  return <div className="skeleton" style={{ height: h }} aria-label="Loading" />;
}

export function Empty({ title, body }) {
  return (
    <div className="empty">
      <div className="h3" style={{ color: 'var(--ink)' }}>
        {title}
      </div>
      {body ? <div style={{ marginTop: 4 }}>{body}</div> : null}
    </div>
  );
}

// Error presentation for every API failure: 401, 403, 404, network, other.
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  if (error.status === 401) {
    return (
      <div className="notice warn" role="alert">
        <Icon name="lock" />
        <div style={{ flex: 1 }}>Your session has ended. Sign in again to continue.</div>
        <Link className="btn sm" href="/login">
          Sign in
        </Link>
      </div>
    );
  }
  if (error.status === 403) {
    return (
      <div className="notice bad" role="alert">
        <Icon name="lock" />
        <div style={{ flex: 1 }}>
          <b>Not permitted.</b> {error.message && error.message !== 'forbidden' ? error.message : 'Your role does not allow this action.'}
        </div>
      </div>
    );
  }
  return (
    <div className="notice bad" role="alert">
      <Icon name="alert" />
      <div style={{ flex: 1 }}>
        {error.status === 404 ? 'Not found. ' : error.status === 0 ? '' : `Error ${error.status || ''} `}
        {error.message}
        {error.code && error.status ? <span className="caption mono muted"> ({error.code})</span> : null}
      </div>
      {onRetry && error.status !== 404 ? (
        <button className="btn sm secondary" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function NoAccess({ what, role }) {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="row">
        <Icon name="lock" size={22} />
        <h2 className="h2">No access</h2>
      </div>
      <p className="soft">
        {what} is available to the <b>admin</b> role{role ? ` — you are signed in as ${role}` : ''}. Ask an admin if you need access.
      </p>
    </div>
  );
}

export function ConfigRequired() {
  return (
    <div className="login-wrap">
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="row">
          <Icon name="alert" size={22} />
          <h1 className="h1">Configuration required</h1>
        </div>
        <p className="soft">
          The admin console talks only to the real Project IRL API. Set these variables in <span className="mono">.env.local</span> (see <span className="mono">.env.example</span>), then rebuild — Next.js inlines <span className="mono">NEXT_PUBLIC_*</span> values at build time.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Status</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              {ENV_VARS.map((v) => (
                <tr key={v.name}>
                  <td className="mono">{v.name}</td>
                  <td>{v.value ? <span className="badge ok">set</span> : <span className="badge bad">missing</span>}</td>
                  <td className="caption soft">{v.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function useToast() {
  const [t, setT] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, kind = 'ok') => {
    setT({ message, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 3600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = t ? (
    <div className={`toast${t.kind === 'err' ? ' err' : ''}`} role="status" aria-live="polite">
      {t.message}
    </div>
  ) : null;
  return [node, show];
}

// Single-resource loader.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ data: s.data, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}

// Cursor-paginated list loader for { items, nextCursor } endpoints.
export function useCursorList(fetchPage, map = (x) => x, deps = []) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const my = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage(undefined);
      if (my !== gen.current) return;
      setItems(listOf(res).map(map));
      setCursor(cursorOf(res));
    } catch (e) {
      if (my === gen.current) setError(e);
    } finally {
      if (my === gen.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const my = gen.current;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetchPage(cursor);
      if (my !== gen.current) return;
      setItems((prev) => [...prev, ...listOf(res).map(map)]);
      setCursor(cursorOf(res));
    } catch (e) {
      setError(e);
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, setItems, hasMore: !!cursor, loading, loadingMore, error, reload: load, loadMore };
}

export function LoadMore({ list }) {
  if (!list.hasMore) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
      <button className="btn secondary" onClick={list.loadMore} disabled={list.loadingMore}>
        {list.loadingMore ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

export function PageHead({ eyebrow, title, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="display">{title}</h1>
      </div>
      <div className="row wrap">{children}</div>
    </div>
  );
}

export const fmtMaybe = (v, f = (x) => x) => (v === undefined || v === null || Number.isNaN(v) ? '—' : f(v));
