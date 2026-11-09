'use client';
// Announcements for pilot launches and events: POST /admin/announcements (dry run, then a
// reason-required send) and GET /admin/announcements (history + the 3 per 24 h limit).
// Only active members who turned on "News & offers" receive them, in-app and by push.
import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import Icon from '@/components/Icon';
import Mascot from '@/components/Mascot';
import ActionDialog from '@/components/ActionDialog';
import { Empty, ErrorBox, PageHead, Skeleton, StatusBadge, useLoad, useToast } from '@/components/ui';
import { dateTime, num } from '@/lib/format';

const TITLE_MAX = 60;
const BODY_MAX = 180;
const DEEP_LINK = /^projectirl:\/\/[a-z0-9][a-z0-9/_-]*(\?[A-Za-z0-9_=&.%-]*)?$/;
const LINKS = [
  ['', 'No link'],
  ['projectirl://discover/home', 'Discover'],
  ['projectirl://me/perks', 'Your perks'],
  ['projectirl://quest/home', 'Quests'],
  ['projectirl://circles/home', 'Circles'],
  ['projectirl://my/activities', 'My plans'],
  ['projectirl://create/activity/type', 'Create a plan'],
  ['projectirl://live/radar', 'Live radar'],
  ['projectirl://premium/compare', 'Plus and Pro'],
  ['custom', 'Custom link'],
];
const linkName = (url) => (LINKS.find(([v]) => v && v === url) || [])[1] || url;

function Counter({ value, max }) {
  const n = value.length;
  return <span className={`counter${n > max ? ' over' : ''}`}>{`${n}/${max}`}</span>;
}

function istClock() {
  const now = new Date();
  return {
    time: now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
    date: now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }),
  };
}

function PhonePreview({ title, body, link }) {
  const [clock, setClock] = useState({ time: '', date: '' });
  useEffect(() => setClock(istClock()), []);
  return (
    <div>
      <div className="phone" aria-label="Notification preview">
        <div className="phone-time">{clock.time}</div>
        <div className="phone-date">{clock.date}</div>
        <div className="push">
          <div className="push-head">
            <span className="push-icon" aria-hidden="true">
              <Mascot size={18} />
            </span>
            <span style={{ letterSpacing: 0.4 }}>COME OVER</span>
            <span style={{ marginLeft: 'auto', fontWeight: 500 }}>now</span>
          </div>
          <div className="push-title">{title.trim() || <span className="muted">Your title</span>}</div>
          <div className="push-body">{body.trim() || <span className="muted">Your message shows here.</span>}</div>
        </div>
      </div>
      <p className="caption muted" style={{ textAlign: 'center', margin: '10px 0 0' }}>
        {link ? `Tapping opens ${linkName(link)}.` : 'Tapping opens the app.'} It also lands in the in-app notifications list.
      </p>
    </div>
  );
}

export default function AnnouncementsPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('all');
  const [area, setArea] = useState('');
  const [preset, setPreset] = useState('projectirl://discover/home');
  const [custom, setCustom] = useState('projectirl://');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [toast, showToast] = useToast();

  const history = useLoad(() => api.announcements(), []);
  const areas = useLoad(() => api.areas(), []);
  const areaGroups = useMemo(() => {
    const groups = new Map();
    for (const a of areas.data?.items || []) {
      if (a.active === false) continue;
      if (!groups.has(a.city)) groups.set(a.city, []);
      groups.get(a.city).push(a.name);
    }
    return [...groups.entries()].map(([city, names]) => [city, [...new Set(names)].sort()]);
  }, [areas.data]);

  const audience = kind === 'area' ? { kind: 'area', value: area } : { kind: 'all' };
  const audienceKey = JSON.stringify(audience);
  const audienceLabel = kind === 'area' ? (area ? `Members in ${area}` : 'One area') : 'Everyone';
  const link = preset === 'custom' ? custom.trim() : preset;
  const linkOk = !link || DEEP_LINK.test(link);
  const fresh = check && check.key === audienceKey;
  const limit = history.data?.limit;
  const left = limit ? Math.max(0, limit.max - limit.usedLast24h) : null;
  const titleOk = title.trim().length >= 2 && title.trim().length <= TITLE_MAX;
  const bodyOk = body.trim().length >= 2 && body.trim().length <= BODY_MAX;
  const audienceOk = kind === 'all' || !!area;

  const blocker = !titleOk
    ? 'Add a title (2 to 60 characters).'
    : !bodyOk
      ? 'Add a message (2 to 180 characters).'
      : !linkOk
        ? 'Fix the link: it must start with projectirl://'
        : !fresh
          ? 'Check the audience before sending.'
          : !check.recipients
            ? 'Nobody in this audience can receive it.'
            : left === 0
              ? 'The limit of 3 sends in 24 hours is reached.'
              : null;

  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await api.announce({ audience, dryRun: true });
      setCheck({ key: audienceKey, recipients: res?.recipients ?? 0, eligible: res?.eligible ?? null, optedOut: res?.optedOut ?? null });
    } catch (e) {
      setCheckError(e);
    } finally {
      setChecking(false);
    }
  };

  const items = history.data?.items || [];

  return (
    <>
      <PageHead eyebrow="Growth" title="Announcements">
        {limit ? (
          <span className={`badge ${left ? 'peri' : 'warn'}`}>
            {left} of {limit.max} sends left in 24 hours
          </span>
        ) : null}
      </PageHead>

      <div className="cols-2">
        <div className="card">
          <h2 className="h3">Compose</h2>
          <p className="caption soft" style={{ margin: '4px 0 16px' }}>
            For pilot launches and events. Only active members who turned on News &amp; offers receive it, in the app and by push. Push skips anyone in their quiet hours.
          </p>

          <div className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="label" htmlFor="ann-title">
                Title
              </label>
              <Counter value={title} max={TITLE_MAX} />
            </div>
            <input id="ann-title" className="input" value={title} maxLength={TITLE_MAX + 20} placeholder="Come Over is live in Indore" onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="label" htmlFor="ann-body">
                Message
              </label>
              <Counter value={body} max={BODY_MAX} />
            </div>
            <textarea id="ann-body" className="textarea" value={body} maxLength={BODY_MAX + 40} placeholder="Small plans with people nearby. Find a chai, a walk or a game this weekend." onChange={(e) => setBody(e.target.value)} />
          </div>

          <div className="field">
            <span className="label">Audience</span>
            <div className="radio-row" role="radiogroup" aria-label="Audience">
              <button type="button" role="radio" aria-checked={kind === 'all'} className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>
                Everyone
              </button>
              <button type="button" role="radio" aria-checked={kind === 'area'} className={`chip${kind === 'area' ? ' on' : ''}`} onClick={() => setKind('area')}>
                One area
              </button>
              {kind === 'area' ? (
                <select className="select" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)} style={{ width: 'auto', minWidth: 200, minHeight: 36, borderRadius: 999, padding: '6px 14px' }}>
                  <option value="">Choose an area</option>
                  {areaGroups.map(([city, names]) => (
                    <optgroup key={city} label={city}>
                      {names.map((n) => (
                        <option key={`${city}-${n}`} value={n}>
                          {n}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : null}
            </div>
            {kind === 'area' && areas.error ? <span className="caption" style={{ color: 'var(--danger)' }}>Could not load areas: {areas.error.message}</span> : null}
            {kind === 'area' && !areas.loading && !areas.error && !areaGroups.length ? <span className="caption muted">No active areas yet. Add them under Taxonomy &amp; quests.</span> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="ann-link">
              Opens <span className="muted">(optional)</span>
            </label>
            <select id="ann-link" className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {LINKS.map(([v, l]) => (
                <option key={v || 'none'} value={v}>
                  {v && v !== 'custom' ? `${l} (${v.replace('projectirl://', '')})` : l}
                </option>
              ))}
            </select>
            {preset === 'custom' ? (
              <>
                <input className="input mono" aria-label="Custom deep link" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="projectirl://discover/home" />
                {!linkOk ? <span className="caption" style={{ color: 'var(--danger)' }}>Use an app link like projectirl://discover/home</span> : null}
              </>
            ) : null}
          </div>

          <div className="divider" />

          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn secondary" onClick={runCheck} disabled={checking || !audienceOk}>
              <Icon name="users" size={16} /> {checking ? 'Checking…' : 'Check audience'}
            </button>
            <button className="btn" onClick={() => setConfirming(true)} disabled={!!blocker}>
              <Icon name="megaphone" size={16} /> Send announcement
            </button>
          </div>

          <div style={{ marginTop: 12 }} aria-live="polite">
            <ErrorBox error={checkError} onRetry={runCheck} />
            {check && fresh ? (
              check.recipients ? (
                <div className="notice">
                  <Icon name="users" />
                  <div>
                    <b>{num(check.recipients)}</b> {check.recipients === 1 ? 'person' : 'people'} will get this ({audienceLabel.toLowerCase()}).
                    {check.optedOut ? ` ${num(check.optedOut)} more in this audience have News & offers turned off, so they are skipped.` : ''}
                  </div>
                </div>
              ) : (
                <div className="notice warn">
                  <Icon name="info" />
                  <div>Nobody in this audience has News &amp; offers turned on{check.optedOut ? ` (${num(check.optedOut)} have it off)` : ''}.</div>
                </div>
              )
            ) : check && !fresh ? (
              <div className="caption muted">The audience changed. Check it again before sending.</div>
            ) : null}
            {blocker && fresh && check.recipients ? <div className="caption muted" style={{ marginTop: 6 }}>{blocker}</div> : null}
            {!check ? <div className="caption muted">{blocker}</div> : null}
          </div>
        </div>

        <div className="card">
          <h2 className="h3" style={{ marginBottom: 14 }}>
            Preview
          </h2>
          <PhonePreview title={title} body={body} link={linkOk ? link : ''} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2 className="h3">Sent</h2>
          {limit?.nextAvailableAt && !left ? <span className="caption muted">Next send possible {dateTime(limit.nextAvailableAt)}</span> : null}
        </div>
        <ErrorBox error={history.error} onRetry={history.reload} />
        {history.loading && !history.data ? (
          <Skeleton h={160} />
        ) : !items.length ? (
          history.error ? null : <Empty title="Nothing sent yet" body="Announcements you send appear here with their audience and reach." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Announcement</th>
                  <th>Audience</th>
                  <th>Opens</th>
                  <th className="num">Recipients</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="soft" style={{ whiteSpace: 'nowrap' }}>
                      {dateTime(a.createdAt)}
                      {a.status && a.status !== 'sent' ? (
                        <div style={{ marginTop: 4 }}>
                          <StatusBadge status={a.status} />
                        </div>
                      ) : null}
                    </td>
                    <td style={{ maxWidth: 360 }}>
                      <div style={{ fontWeight: 600 }}>{a.title}</div>
                      <div className="caption soft">{a.body}</div>
                      {a.reason ? <div className="caption muted" style={{ marginTop: 4 }}>Why: {a.reason}</div> : null}
                    </td>
                    <td>{a.audience?.kind === 'area' ? a.audience.value : 'Everyone'}</td>
                    <td className="caption soft">{a.deepLink ? linkName(a.deepLink) : 'App'}</td>
                    <td className="num">{num(a.recipients || 0)}</td>
                    <td className="soft">{a.createdBy?.name || 'Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ActionDialog
        open={confirming}
        title="Send announcement"
        subtitle={fresh ? `${audienceLabel}: ${num(check.recipients)} ${check.recipients === 1 ? 'person' : 'people'} with News & offers on. It goes out in the app and by push, and cannot be recalled.` : ''}
        options={fresh ? [{ value: 'send', label: `Send to ${num(check.recipients)} ${check.recipients === 1 ? 'person' : 'people'}` }] : []}
        defaultValue="send"
        confirmLabel="Confirm"
        onClose={() => setConfirming(false)}
        onSubmit={async ({ reason }) => {
          const res = await api.announce({ title: title.trim(), body: body.trim(), audience, deepLink: link || null, reason });
          showToast(`Sent to ${num(res?.recipients ?? 0)} ${res?.recipients === 1 ? 'person' : 'people'}`);
          setTitle('');
          setBody('');
          setCheck(null);
          history.reload();
        }}
      />
      {toast}
    </>
  );
}
