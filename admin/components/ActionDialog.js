'use client';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

// Enforcement dialog: pick an action, write a reason (required, audited).
// options: [{ value, label, description, danger, disabled, disabledReason }]
// Options with `duration: true` show an optional "duration in days" field when
// `withDuration` is set (blank = until lifted).
export default function ActionDialog({ open, title, subtitle, options = [], defaultValue, confirmLabel = 'Confirm', requireReason = true, withDuration = false, onSubmit, onClose }) {
  const [value, setValue] = useState(defaultValue || options.find((o) => !o.disabled)?.value);
  const [reason, setReason] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue || options.find((o) => !o.disabled)?.value);
      setReason('');
      setDurationDays('');
      setError(null);
      setTimeout(() => ref.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && !busy && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  const selected = options.find((o) => o.value === value);
  const reasonOk = !requireReason || reason.trim().length >= 10;
  const showDuration = withDuration && selected?.duration;
  const durationOk = !showDuration || durationDays === '' || (Number(durationDays) >= 1 && Number(durationDays) <= 365);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ action: value, reason: reason.trim(), durationDays: showDuration && durationDays !== '' ? Number(durationDays) : undefined });
      onClose?.();
    } catch (e) {
      setError(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h2 className="h2" id="dlg-title">
              {title}
            </h2>
            {subtitle ? <p className="soft" style={{ margin: '4px 0 0' }}>{subtitle}</p> : null}
          </div>
          <button className="btn sm secondary" onClick={onClose} aria-label="Close" disabled={busy}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {options.length > 1 ? (
          <div style={{ marginTop: 16 }} role="radiogroup" aria-label="Action">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={value === o.value}
                className={`option${value === o.value ? ' on' : ''}`}
                disabled={o.disabled}
                onClick={() => setValue(o.value)}
                title={o.disabled ? o.disabledReason : undefined}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    border: '2px solid var(--ink)',
                    background: value === o.value ? 'var(--ink)' : 'transparent',
                    flex: 'none',
                    marginTop: 2,
                  }}
                />
                <span>
                  <span style={{ fontWeight: 600, color: o.danger ? 'var(--danger)' : 'var(--ink)' }}>{o.label}</span>
                  {o.description ? <span className="caption muted" style={{ display: 'block', marginTop: 2 }}>{o.disabled ? o.disabledReason : o.description}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {showDuration ? (
          <div className="field" style={{ marginTop: 16 }}>
            <label className="label" htmlFor="dlg-duration">
              Duration in days <span className="muted">(optional · blank = until lifted)</span>
            </label>
            <input id="dlg-duration" type="number" min={1} max={365} className="input" style={{ maxWidth: 160 }} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
          </div>
        ) : null}

        <div className="field" style={{ marginTop: 16 }}>
          <label className="label" htmlFor="dlg-reason">
            Reason {requireReason ? <span className="muted">(required · stored in the audit log)</span> : null}
          </label>
          <textarea
            id="dlg-reason"
            ref={ref}
            className="textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What did you see, and why does this action fit the policy?"
            maxLength={600}
          />
          <span className="caption muted">{reason.trim().length}/600 · min 10 characters</span>
        </div>

        {error ? (
          <div className="notice bad" role="alert" style={{ marginBottom: 12 }}>
            <Icon name="alert" />
            {error}
          </div>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`btn${selected?.danger ? ' danger' : ''}`} onClick={submit} disabled={busy || !reasonOk || !durationOk || !value || selected?.disabled}>
            {busy ? 'Saving…' : selected ? `${confirmLabel}: ${selected.label}` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
