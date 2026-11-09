'use client';
import { useState } from 'react';
import api from '@/lib/api';
import { listOf, normArea, normCategory, normQuest } from '@/lib/normalize';
import ActionDialog from '@/components/ActionDialog';
import Icon from '@/components/Icon';
import { Empty, ErrorBox, PageHead, Skeleton, fmtMaybe, useLoad, useToast } from '@/components/ui';
import { num } from '@/lib/format';

const TABS = [
  ['categories', 'Categories'],
  ['areas', 'City areas'],
  ['quests', 'Quests'],
];
const RISK_TONE = { standard: 'ok', elevated: 'warn', restricted: 'bad' };
const BANNED_QUEST_SIGNALS = /(message|swipe|like|chat|app_open|screen_time|session)/i;

// ---------------- categories ----------------
function Categories({ confirm, toast }) {
  const { data, error, loading, reload } = useLoad(() => api.categories(), []);
  const rows = listOf(data).map(normCategory);
  const [form, setForm] = useState({ slug: '', label: '', risk: 'standard' });

  const change = (c, patch, label) =>
    confirm({
      title: `Update “${c.label}”`,
      subtitle: label,
      run: async (reason) => {
        await api.updateCategory(c.slug, { ...patch, reason });
        await reload();
      },
    });

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="h2">Activity categories</h2>
        <span className="caption muted">Restricted categories cannot be active</span>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Skeleton h={240} />
      ) : !rows.length ? (
        error ? null : <Empty title="No categories yet" body="Add the first one below." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Slug</th>
                <th>Risk level</th>
                <th className="num">Plans (30d)</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.slug}>
                  <td style={{ fontWeight: 600 }}>{c.label}</td>
                  <td className="mono">{c.slug}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <span className={`badge ${RISK_TONE[c.risk] || ''}`}>{c.risk}</span>
                      <select
                        className="select"
                        style={{ width: 140, minHeight: 36, padding: '4px 10px' }}
                        value={c.risk}
                        aria-label={`Risk level for ${c.label}`}
                        onChange={(e) => change(c, e.target.value === 'restricted' ? { riskLevel: e.target.value, isActive: false } : { riskLevel: e.target.value }, `Risk level → ${e.target.value}${e.target.value === 'restricted' ? ' (also deactivates)' : ''}`)}
                      >
                        <option value="standard">standard</option>
                        <option value="elevated">elevated</option>
                        <option value="restricted">restricted</option>
                      </select>
                    </div>
                  </td>
                  <td className="num">{fmtMaybe(c.plans30d, num)}</td>
                  <td>
                    <button
                      className={`toggle${c.active ? ' on' : ''}`}
                      role="switch"
                      aria-checked={c.active}
                      aria-label={`${c.label} active`}
                      disabled={c.risk === 'restricted' && !c.active}
                      title={c.risk === 'restricted' && !c.active ? 'Restricted categories cannot be enabled' : undefined}
                      onClick={() => change(c, { isActive: !c.active }, c.active ? 'Deactivate: hidden from create and discovery' : 'Activate')}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="divider" />
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[a-z0-9_]{2,32}$/.test(form.slug)) {
            toast('Slug must be 2–32 lowercase letters, digits or underscores.', 'err');
            return;
          }
          confirm({
            title: `Add category “${form.label}”`,
            subtitle: `${form.slug} · ${form.risk}`,
            run: async (reason) => {
              await api.createCategory({ slug: form.slug, label: form.label, riskLevel: form.risk, isActive: form.risk !== 'restricted', reason });
              setForm({ slug: '', label: '', risk: 'standard' });
              await reload();
            },
          });
        }}
      >
        <input className="input" style={{ width: 160 }} placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} aria-label="New category slug" />
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="New category label" />
        <select className="select" style={{ width: 150 }} value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })} aria-label="New category risk">
          <option value="standard">standard</option>
          <option value="elevated">elevated</option>
          <option value="restricted">restricted</option>
        </select>
        <button className="btn" type="submit" disabled={!form.slug || !form.label}>
          <Icon name="plus" size={14} /> Add category
        </button>
      </form>
    </div>
  );
}

// ---------------- areas ----------------
function Areas({ confirm, toast }) {
  const { data, error, loading, reload } = useLoad(() => api.areas(), []);
  const rows = listOf(data).map(normArea);
  const [form, setForm] = useState({ city: 'Ahmedabad', name: '', latitude: '', longitude: '' });
  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  const coordsOk = form.latitude !== '' && form.longitude !== '' && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="h2">City areas</h2>
        <span className="caption muted">Used for the location-off discovery path; centroids are area-level, never a person’s position</span>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Skeleton h={220} />
      ) : !rows.length ? (
        error ? null : <Empty title="No areas yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Area</th>
                <th>City</th>
                <th>Pilot</th>
                <th className="num">Plans / week</th>
                <th className="num">Median time to accept</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td className="soft">{a.city || 'n/a'}</td>
                  <td>{a.pilot ? <span className="badge peri">pilot</span> : <span className="muted">n/a</span>}</td>
                  <td className="num">{fmtMaybe(a.plansWeek, num)}</td>
                  <td className="num">{fmtMaybe(a.medianAcceptMin, (v) => `${v} min`)}</td>
                  <td>
                    <button
                      className={`toggle${a.active ? ' on' : ''}`}
                      role="switch"
                      aria-checked={a.active}
                      aria-label={`${a.name} active`}
                      onClick={() =>
                        confirm({
                          title: `${a.active ? 'Deactivate' : 'Activate'} ${a.name}`,
                          run: async (reason) => {
                            await api.updateArea(a.id, { active: !a.active, reason });
                            await reload();
                          },
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="divider" />
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (!coordsOk) {
            toast('Enter a valid centroid latitude and longitude.', 'err');
            return;
          }
          confirm({
            title: `Add area “${form.name}”`,
            subtitle: `${form.city} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            run: async (reason) => {
              await api.createArea({ city: form.city, name: form.name, latitude: lat, longitude: lng, active: true, reason });
              setForm({ ...form, name: '', latitude: '', longitude: '' });
              await reload();
            },
          });
        }}
      >
        <input className="input" style={{ width: 150 }} placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} aria-label="City" />
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Area name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Area name" />
        <input className="input" style={{ width: 130 }} placeholder="Centroid lat" inputMode="decimal" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} aria-label="Centroid latitude" />
        <input className="input" style={{ width: 130 }} placeholder="Centroid lng" inputMode="decimal" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} aria-label="Centroid longitude" />
        <button className="btn" type="submit" disabled={!form.city || !form.name}>
          <Icon name="plus" size={14} /> Add area
        </button>
      </form>
    </div>
  );
}

// ---------------- quests ----------------
const blankQuest = { id: null, slug: '', title: '', description: '', xp: 50, active: false, startsAt: null, endsAt: null, criteria: { event: 'activity.completed', count: 1 } };
const toDateInput = (iso) => (iso ? String(iso).slice(0, 10) : '');

function Quests({ confirm }) {
  const { data, error, loading, reload } = useLoad(() => api.quests(), []);
  const rows = listOf(data).map(normQuest);
  const [editing, setEditing] = useState(null);
  const [json, setJson] = useState('');
  const [jsonErr, setJsonErr] = useState(null);

  const edit = (q) => {
    setEditing({ ...q });
    setJson(JSON.stringify(q.criteria || {}, null, 2));
    setJsonErr(null);
  };

  const parse = () => {
    try {
      const c = JSON.parse(json);
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('criteria must be a JSON object');
      setJsonErr(null);
      return c;
    } catch (e) {
      setJsonErr(`Invalid criteria: ${e.message}`);
      return null;
    }
  };

  const save = () => {
    const criteria = parse();
    if (!criteria) return;
    if (!(editing.xp >= 0 && editing.xp <= 500)) {
      setJsonErr('XP reward must be between 0 and 500.');
      return;
    }
    if (BANNED_QUEST_SIGNALS.test(JSON.stringify(criteria))) {
      setJsonErr('Quests may only reward verified real-world activity, not messages, likes, swipes or app time.');
      return;
    }
    const isNew = !editing.id;
    const body = {
      slug: editing.slug,
      title: editing.title,
      description: editing.description,
      criteria,
      xpReward: Number(editing.xp),
      startsAt: editing.startsAt,
      endsAt: editing.endsAt,
      active: editing.active,
    };
    confirm({
      title: isNew ? `Create quest “${editing.title}”` : `Update quest “${editing.title}”`,
      subtitle: `+${editing.xp} XP · ${editing.active ? 'active' : 'inactive'}`,
      run: async (reason) => {
        if (isNew) await api.createQuest({ ...body, reason });
        else await api.updateQuest(editing.id, { ...body, reason });
        setEditing(null);
        await reload();
      },
    });
  };

  return (
    <div className="cols-2">
      <div className="card">
        <div className="card-head">
          <h2 className="h2">Quests</h2>
          <button className="btn sm" onClick={() => edit(blankQuest)}>
            <Icon name="plus" size={14} /> New quest
          </button>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? (
          <Skeleton h={200} />
        ) : !rows.length ? (
          error ? null : <Empty title="No quests yet" />
        ) : (
          rows.map((q) => (
            <button key={q.id || q.slug} className={`option${editing && editing.id === q.id ? ' on' : ''}`} onClick={() => edit(q)}>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{q.title || q.slug}</span>
                <span className="caption muted mono" style={{ display: 'block' }}>
                  {q.slug}
                  {q.kind ? ` · ${q.kind}` : ''}
                </span>
              </span>
              <span className="badge ink">+{q.xp} XP</span>
              <span className={`badge ${q.active ? 'ok' : ''}`}>{q.active ? 'active' : 'inactive'}</span>
            </button>
          ))
        )}
        <p className="caption muted">Quests reward verified, completed real-world activity only. XP is computed server-side with a daily cap.</p>
      </div>

      <div className="card">
        {!editing ? (
          <div className="empty">Select a quest to edit its criteria, reward and active window.</div>
        ) : (
          <>
            <h2 className="h2" style={{ marginBottom: 14 }}>
              {editing.id ? 'Edit quest' : 'New quest'}
            </h2>
            <div className="field">
              <label className="label" htmlFor="q-slug">
                Slug
              </label>
              <input id="q-slug" className="input mono" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} disabled={!!editing.id} />
            </div>
            <div className="field">
              <label className="label" htmlFor="q-title">
                Title
              </label>
              <input id="q-title" className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="q-desc">
                Description
              </label>
              <input id="q-desc" className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="q-xp">
                  XP reward (0–500)
                </label>
                <input id="q-xp" type="number" min={0} max={500} className="input" value={editing.xp} onChange={(e) => setEditing({ ...editing, xp: Number(e.target.value) })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="q-start">
                  Starts
                </label>
                <input id="q-start" type="date" className="input" value={toDateInput(editing.startsAt)} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="q-end">
                  Ends
                </label>
                <input id="q-end" type="date" className="input" value={toDateInput(editing.endsAt)} onChange={(e) => setEditing({ ...editing, endsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="q-criteria">
                Criteria (JSON)
              </label>
              <textarea id="q-criteria" className="textarea mono" style={{ minHeight: 150 }} value={json} onChange={(e) => setJson(e.target.value)} onBlur={parse} />
              {jsonErr ? <span className="caption" style={{ color: 'var(--danger)' }}>{jsonErr}</span> : <span className="caption muted">Evaluated server-side on verified completion events.</span>}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="row" style={{ gap: 8 }}>
                <button type="button" className={`toggle${editing.active ? ' on' : ''}`} role="switch" aria-checked={editing.active} aria-label="Quest active" onClick={() => setEditing({ ...editing, active: !editing.active })} />
                <span className="label">Active</span>
              </label>
              <div className="row">
                <button className="btn secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn" disabled={!editing.title || !editing.slug || !editing.description} onClick={save}>
                  Save quest
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TaxonomyPage() {
  const [tab, setTab] = useState('categories');
  const [pending, setPending] = useState(null);
  const [toast, showToast] = useToast();

  return (
    <>
      <PageHead eyebrow="Configuration" title="Taxonomy & quests">
        <div className="tabs" role="tablist">
          {TABS.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>
      </PageHead>

      {tab === 'categories' ? <Categories confirm={setPending} toast={showToast} /> : null}
      {tab === 'areas' ? <Areas confirm={setPending} toast={showToast} /> : null}
      {tab === 'quests' ? <Quests confirm={setPending} /> : null}

      <ActionDialog
        open={!!pending}
        title={pending?.title}
        subtitle={pending?.subtitle}
        options={[{ value: 'save', label: 'Save change' }]}
        defaultValue="save"
        confirmLabel="Confirm"
        onClose={() => setPending(null)}
        onSubmit={async ({ reason }) => {
          await pending.run(reason);
          showToast('Saved');
        }}
      />
      {toast}
    </>
  );
}
