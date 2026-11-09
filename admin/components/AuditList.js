import Link from 'next/link';
import { dateTime, timeAgo } from '@/lib/format';

const targetHref = (type, id) => {
  if (!id) return null;
  if (type === 'user') return `/admin/users/${encodeURIComponent(id)}`;
  if (type === 'report') return `/admin/reports/${encodeURIComponent(id)}`;
  if (type === 'activity') return '/admin/activities';
  if (['category', 'area', 'quest', 'city_area', 'activity_category'].includes(type)) return '/admin/taxonomy';
  return null;
};

// Renders normalised audit entries (see normAudit).
export default function AuditList({ entries = [], showTarget = false, empty = 'No audit entries yet.' }) {
  if (!entries.length) return <div className="empty">{empty}</div>;
  return (
    <div>
      {entries.map((e, i) => {
        const href = showTarget ? targetHref(e.targetType, e.targetId) : null;
        const danger = /suspend|remove|block/.test(e.action);
        return (
          <div key={e.id || i} className="audit-item">
            <span className="pin" style={{ background: danger ? 'var(--danger)' : /evidence|view/.test(e.action) ? 'var(--orange)' : undefined }} />
            <div style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {e.action}
                </span>
                {showTarget && e.targetType ? (
                  href ? (
                    <Link href={href} className="badge peri">
                      {e.targetType}:{String(e.targetId || '').slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="badge">
                      {e.targetType}:{String(e.targetId || '').slice(0, 8)}
                    </span>
                  )
                ) : null}
                <span className="caption muted" title={e.at ? dateTime(e.at) : undefined}>
                  {e.at ? timeAgo(e.at) : 'n/a'} · {e.actorName} ({e.actorRole})
                </span>
              </div>
              {e.reason ? <div className="soft" style={{ marginTop: 2 }}>{e.reason}</div> : null}
              {e.id ? <div className="caption muted mono">#{e.id}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
