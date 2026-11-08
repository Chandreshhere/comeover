'use client';
import { useState } from 'react';
import api from '@/lib/api';
import { normAudit } from '@/lib/normalize';
import AuditList from '@/components/AuditList';
import Icon from '@/components/Icon';
import { ErrorBox, LoadMore, PageHead, Skeleton, useCursorList } from '@/components/ui';

const TYPES = ['', 'report', 'user', 'activity', 'message', 'category', 'area', 'quest', 'subscription'];

export default function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [entityIdInput, setEntityIdInput] = useState('');
  const [entityId, setEntityId] = useState('');
  const list = useCursorList((cursor) => api.audit({ entityType, entityId, cursor }), normAudit, [entityType, entityId]);

  return (
    <>
      <PageHead eyebrow="Trust & safety" title="Audit log">
        <button className="btn secondary sm" onClick={list.reload} disabled={list.loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </PageHead>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        {TYPES.map((t) => (
          <button key={t || 'all'} className={`chip${entityType === t ? ' on' : ''}`} onClick={() => setEntityType(t)} aria-pressed={entityType === t}>
            {t || 'Everything'}
          </button>
        ))}
      </div>
      <form
        className="row"
        style={{ marginBottom: 16, maxWidth: 560 }}
        onSubmit={(e) => {
          e.preventDefault();
          setEntityId(entityIdInput.trim());
        }}
      >
        <input className="input mono" placeholder="Filter by entity id (optional)" value={entityIdInput} onChange={(e) => setEntityIdInput(e.target.value)} aria-label="Entity id" />
        <button className="btn secondary" type="submit">
          Apply
        </button>
        {entityId ? (
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setEntityId('');
              setEntityIdInput('');
            }}
          >
            Clear
          </button>
        ) : null}
      </form>
      <ErrorBox error={list.error} onRetry={list.reload} />
      <div className="card">
        {list.loading ? <Skeleton h={300} /> : list.error && !list.items.length ? null : <AuditList entries={list.items} showTarget empty="No audit entries match." />}
        <LoadMore list={list} />
      </div>
      <p className="caption muted" style={{ marginTop: 12 }}>
        Append-only. Entries cannot be edited or deleted from the console; retention follows the data-retention schedule.
      </p>
    </>
  );
}
