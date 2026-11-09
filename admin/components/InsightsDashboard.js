'use client';
// Renders GET /admin/insights (plus optional /admin/kpis extras) for the dashboard page.
// Every panel shows a calm empty state when its data is missing or zero, never NaN.
import Link from 'next/link';
import Icon from '@/components/Icon';
import { BarChart, ChartCard, ChartEmpty, CohortTable, Columns, Funnel, HBarList, Heatmap, LineChart, NEUTRAL, SERIES, SegmentedBar, Sparkline, hourLabel } from '@/components/charts';
import { REASONS, dayLabel, num, rupees } from '@/lib/format';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Colour follows the measure across every chart on this page.
const C = { signups: SERIES[0], engaged: SERIES[1], completed: SERIES[2], plans: SERIES[3] };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const n0 = (v) => (isNum(v) ? v : 0);
const pctText = (v, digits = 0) => (isNum(v) ? `${(v * 100).toFixed(digits)}%` : 'n/a');
const col = (series, key) => (series || []).map((d) => n0(d[key]));

// Change vs the previous equal-length period. Counts in %, rates in percentage points.
function deltaOf(cur, prev, { rate = false } = {}) {
  if (!isNum(cur) || !isNum(prev)) return null;
  if (rate) {
    const pts = (cur - prev) * 100;
    if (Math.abs(pts) < 0.05) return { dir: 'flat', text: 'No change' };
    return { dir: pts > 0 ? 'up' : 'down', text: `${Math.abs(pts).toFixed(1)} pts` };
  }
  if (cur === prev) return { dir: 'flat', text: 'No change' };
  if (prev === 0) return { dir: 'up', text: `${num(cur)} new` };
  const change = (cur - prev) / prev;
  return { dir: change > 0 ? 'up' : 'down', text: `${Math.abs(Math.round(change * 100))}%` };
}

function Delta({ d, goodWhen = 'up', short = false }) {
  if (!d) return <span className="delta-line">No earlier data</span>;
  const tone = d.dir === 'flat' ? '' : d.dir === goodWhen ? 'good' : 'bad';
  return (
    <span className={`delta-line ${d.dir} ${tone}`} aria-label={`${d.dir === 'up' ? 'Up' : d.dir === 'down' ? 'Down' : ''} ${d.text} vs prior period`}>
      {d.dir !== 'flat' ? <Icon name={d.dir === 'up' ? 'arrowUp' : 'arrowDown'} size={12} stroke={2.4} /> : null}
      {d.text}
      {short ? null : (
        <span className="muted" style={{ fontWeight: 500 }}>
          vs prior period
        </span>
      )}
    </span>
  );
}

function StatTile({ label, value, hint, delta, spark, color = SERIES[0] }) {
  return (
    <div className="stat" title={hint}>
      <span className="label soft">{label}</span>
      <span className="value">{value}</span>
      <Delta d={delta} />
      <div className="trend">
        {(spark || []).some((v) => isNum(v) && v > 0) ? <Sparkline data={spark} stroke={color} height={36} label={`${label} trend`} /> : <div style={{ height: 36 }} aria-hidden="true" />}
      </div>
      {hint ? <span className="caption muted">{hint}</span> : null}
    </div>
  );
}

function Fact({ label, value, sub }) {
  return (
    <div className="fact">
      <div className="caption muted">{label}</div>
      <div className="n">{value}</div>
      {sub ? <div className="caption soft">{sub}</div> : null}
    </div>
  );
}

function TileLink({ href, children }) {
  return (
    <Link href={href} className="tile-link">
      {children} <Icon name="chevron" size={14} />
    </Link>
  );
}

const allZero = (...arrays) => arrays.every((a) => !a.some((v) => v > 0));

export default function InsightsDashboard({ k, legacy, loading }) {
  const series = Array.isArray(k.series) ? k.series : [];
  const days = series.map((d) => d.day);
  const t = k.totals || {};
  const p = t.prev || {};
  const rates = k.rates || {};
  const ratesPrev = rates.prev || {};
  const daily = Array.isArray(rates.daily) ? rates.daily : [];
  const rev = k.revenue || {};
  const revPrev = rev.prev || {};
  const subs = n0(rev.plus) + n0(rev.pro);
  const subsPrev = isNum(revPrev.plus) ? n0(revPrev.plus) + n0(revPrev.pro) : null;

  const tiles = [
    { label: 'Sign-ups', value: num(n0(t.signups)), delta: deltaOf(t.signups, p.signups), spark: col(series, 'signups'), color: C.signups, hint: 'New accounts' },
    { label: 'Engaged users', value: num(n0(t.engagedUsers)), delta: deltaOf(t.engagedUsers, p.engagedUsers), spark: col(series, 'engagedUsers'), color: C.engaged, hint: 'Created, joined, messaged, checked in or earned XP' },
    { label: 'Plans created', value: num(n0(t.plansCreated)), delta: deltaOf(t.plansCreated, p.plansCreated), spark: col(series, 'plansCreated'), color: C.plans, hint: 'Published plans' },
    { label: 'Meetups completed', value: num(n0(t.completed)), delta: deltaOf(t.completed, p.completed), spark: col(series, 'completed'), color: C.completed, hint: 'Plans that happened' },
    { label: 'Show-up rate', value: pctText(rates.showUpRate), delta: deltaOf(rates.showUpRate, ratesPrev.showUpRate, { rate: true }), spark: daily.map((d) => d.showUpRate), hint: 'Accepted guests who checked in' },
    { label: 'Join conversion', value: pctText(rates.joinConversion), delta: deltaOf(rates.joinConversion, ratesPrev.joinConversion, { rate: true }), spark: daily.map((d) => d.joinConversion), hint: 'Join requests that got accepted' },
    { label: 'Partner redemptions', value: num(n0(t.redemptions)), delta: deltaOf(t.redemptions, p.redemptions), spark: col(series, 'redemptions'), hint: 'Verified partner visits' },
    { label: 'Active subscriptions', value: num(subs), delta: deltaOf(subs, subsPrev), spark: (rev.daily || []).map((d) => n0(d.subscriptions)), hint: 'Paid Plus and Pro' },
  ];

  const growth = [
    { key: 'signups', label: 'Sign-ups', color: C.signups, values: col(series, 'signups') },
    { key: 'engagedUsers', label: 'Engaged users', color: C.engaged, values: col(series, 'engagedUsers') },
    { key: 'completed', label: 'Meetups completed', color: C.completed, values: col(series, 'completed') },
  ];
  const plans = [
    { key: 'plansCreated', label: 'Plans created', color: C.plans, values: col(series, 'plansCreated') },
    { key: 'completed', label: 'Meetups completed', color: C.completed, values: col(series, 'completed') },
  ];
  const funnel = (k.funnel || []).map((s) => ({ label: s.label, value: n0(s.value) }));
  const retention = (k.retention || []).map((r) => ({ label: r.label, value: isNum(r.value) ? r.value : null, cohortUsers: n0(r.cohortUsers) }));
  const categories = k.categories || [];
  const areas = k.areas || [];
  const maxAreaPlans = Math.max(0, ...areas.map((a) => n0(a.plans)));
  const heat = k.heatmap?.values || [];
  const style = k.socialStyle || {};
  const styleParts = [
    { label: 'Introvert', value: n0(style.introvert), color: SERIES[0] },
    { label: 'Ambivert', value: n0(style.ambivert), color: SERIES[1] },
    { label: 'Extrovert', value: n0(style.extrovert), color: SERIES[2] },
    { label: 'Not set', value: n0(style.unset), color: NEUTRAL, text: '#090a0e' },
  ];
  const styleTotal = styleParts.reduce((s, x) => s + x.value, 0);
  const levels = (k.levels || []).map((l) => ({ key: String(l.level), label: `L${l.level}${l.name ? ` ${l.name}` : ''}`, value: n0(l.users) }));
  const partners = k.partners || {};
  const safety = k.safety || {};
  const reasons = (safety.reportsByReason || []).map((r) => ({ key: r.reason, label: REASONS[r.reason] || String(r.reason).replace(/_/g, ' '), value: n0(r.n) }));
  const prices = rev.prices || {};
  const holds = partners.tableHolds || {};
  const liquidity = legacy && isNum(legacy.medianMinutesToFirstAccept) ? legacy.medianMinutesToFirstAccept : null;
  const urgent = legacy?.safety && isNum(legacy.safety.urgentOpen) ? legacy.safety.urgentOpen : null;

  return (
    <div className={`dash${loading ? ' refreshing' : ''}`} aria-busy={loading}>
      <div className="dash-kpis">
        {tiles.map((x) => (
          <StatTile key={x.label} {...x} />
        ))}
      </div>

      <ChartCard
        title="Growth and engagement"
        subtitle="Daily totals by IST day"
        legend={allZero(...growth.map((s) => s.values)) ? null : growth.map((s) => ({ label: s.label, color: s.color, kind: 'line' }))}
        table={{ columns: [{ label: 'Day' }, ...growth.map((s) => ({ label: s.label, num: true }))], rows: days.map((d, i) => [dayLabel(d), ...growth.map((s) => num(s.values[i]))]) }}
      >
        {allZero(...growth.map((s) => s.values)) ? <ChartEmpty title="No activity in this range" body="Sign-ups, engaged people and completed meetups will chart here." /> : <LineChart days={days} series={growth} label="Sign-ups, engaged users and meetups completed per day" />}
      </ChartCard>

      <div className="dash-row">
        <ChartCard
          title="Plans created and completed"
          subtitle="Per IST day"
          legend={allZero(...plans.map((s) => s.values)) ? null : plans.map((s) => ({ label: s.label, color: s.color }))}
          table={{ columns: [{ label: 'Day' }, ...plans.map((s) => ({ label: s.label, num: true }))], rows: days.map((d, i) => [dayLabel(d), ...plans.map((s) => num(s.values[i]))]) }}
          footer={liquidity != null ? `Median time from publishing a plan to its first accepted guest: ${num(Math.round(liquidity))} min.` : null}
        >
          {allZero(...plans.map((s) => s.values)) ? <ChartEmpty title="No plans in this range" /> : <BarChart days={days} series={plans} label="Plans created and meetups completed per day" />}
        </ChartCard>
        <ChartCard
          title="Sign-up funnel"
          subtitle="People who signed up in this range"
          table={{ columns: [{ label: 'Step' }, { label: 'People', num: true }], rows: funnel.map((s) => [s.label, num(s.value)]) }}
        >
          <Funnel steps={funnel} />
        </ChartCard>
      </div>

      <div className="dash-row">
        <ChartCard title="Weekly cohorts" subtitle="Last 8 signup weeks, IST, weeks start Sunday">
          <CohortTable cohorts={k.cohorts || []} />
        </ChartCard>
        <ChartCard
          title="Retention"
          subtitle="Share still active 1 to 4 weeks after signing up"
          table={{ columns: [{ label: 'Week' }, { label: 'Active', num: true }, { label: 'Cohort people', num: true }], rows: retention.map((r) => [r.label, pctText(r.value, 1), num(r.cohortUsers)]) }}
          footer="Averaged over cohorts whose week has finished, weighted by cohort size."
        >
          {retention.length && retention.some((r) => r.value != null) ? <Columns data={retention} format={(v) => pctText(v)} emptyLabel="Too early" /> : <ChartEmpty title="Too early to tell" body="Retention shows once a signup week is at least two weeks old." />}
        </ChartCard>
      </div>

      <div className="dash-row even">
        <ChartCard
          title="Top categories"
          subtitle="Plans created in this range"
          table={{ columns: [{ label: 'Category' }, { label: 'Plans', num: true }, { label: 'Completed', num: true }], rows: categories.map((c) => [c.label || c.slug, num(n0(c.plans)), num(n0(c.completed))]) }}
        >
          {categories.length ? (
            <HBarList color={C.plans} label="Plans by category" items={categories.map((c) => ({ key: c.slug, label: c.label || c.slug, value: n0(c.plans), detail: `${num(n0(c.completed))} completed` }))} />
          ) : (
            <ChartEmpty title="No plans in this range" />
          )}
        </ChartCard>
        <ChartCard title="Areas" subtitle="Plans in this range, and members who live there">
          {areas.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th style={{ width: '46%' }}>Plans</th>
                    <th className="num">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {areas.map((a) => (
                    <tr key={a.area}>
                      <td style={{ fontWeight: 600 }}>{a.area}</td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="viz-hbar-track" style={{ flex: 1 }}>
                            {n0(a.plans) > 0 ? <span className="viz-hbar-fill" style={{ width: `${Math.max(2, (n0(a.plans) / maxAreaPlans) * 100)}%`, background: C.plans }} /> : null}
                          </span>
                          <span className="label" style={{ minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {num(n0(a.plans))}
                          </span>
                        </div>
                      </td>
                      <td className="num">{num(n0(a.users))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ChartEmpty title="No areas yet" body="Areas appear when plans or members have a neighbourhood." />
          )}
        </ChartCard>
      </div>

      <div className="dash-row">
        <ChartCard
          title="When plans start"
          subtitle="Plans created in this range, by weekday and start hour (IST)"
          table={{
            columns: [{ label: 'Weekday' }, { label: 'Start hour' }, { label: 'Plans', num: true }],
            rows: heat
              .flatMap((row, d) => (row || []).map((v, h) => ({ d, h, v: n0(v) })))
              .filter((c) => c.v > 0)
              .sort((a, b) => b.v - a.v)
              .map((c) => [WEEKDAYS[c.d], hourLabel(c.h), num(c.v)]),
          }}
        >
          <Heatmap values={heat} unit="plans" />
        </ChartCard>
        <div className="dash-stack">
          <ChartCard
            title="Social style"
            subtitle={`${num(styleTotal)} members with a profile`}
            table={{ columns: [{ label: 'Style' }, { label: 'People', num: true }, { label: 'Share', num: true }], rows: styleParts.map((s) => [s.label, num(s.value), styleTotal ? pctText(s.value / styleTotal) : 'n/a']) }}
          >
            <SegmentedBar parts={styleParts} label="Social style" />
          </ChartCard>
          <ChartCard title="Levels" subtitle="Members at each level" table={{ columns: [{ label: 'Level' }, { label: 'Members', num: true }], rows: levels.map((l) => [l.label, num(l.value)]) }}>
            {levels.some((l) => l.value > 0) ? <HBarList items={levels} label="Members by level" /> : <ChartEmpty title="No members yet" />}
          </ChartCard>
        </div>
      </div>

      <div className="dash-row-3">
        <section className="card viz-card">
          <div className="viz-head">
            <div>
              <h2 className="h3">Partners</h2>
              <div className="caption muted viz-sub">Venues, perks and table holds</div>
            </div>
            <TileLink href="/admin/partners">Open</TileLink>
          </div>
          <div className="facts">
            <Fact label="Verified venues" value={num(n0(partners.venues?.verified))} />
            <Fact label="Waiting for review" value={num(n0(partners.venues?.pending))} />
            <Fact label="Active offers" value={num(n0(partners.offers?.active))} />
            <div className="fact">
              <div className="caption muted">Redemptions</div>
              <div className="n">{num(n0(partners.redemptions?.range))}</div>
              <Delta short d={deltaOf(partners.redemptions?.range, partners.redemptions?.prev)} />
            </div>
          </div>
          <div className="divider" />
          <div className="caption muted">Table holds requested in this range</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <span className="badge peri">{num(n0(holds.requested))} waiting</span>
            <span className="badge ok">{num(n0(holds.confirmed))} confirmed</span>
            <span className="badge bad">{num(n0(holds.declined))} declined</span>
          </div>
        </section>

        <section className="card viz-card">
          <div className="viz-head">
            <div>
              <h2 className="h3">Revenue</h2>
              <div className="caption muted viz-sub">Monthly recurring, estimated</div>
            </div>
            <TileLink href="/admin/billing">Billing</TileLink>
          </div>
          <div className="fact">
            <div className="caption muted">MRR estimate</div>
            <div className="n" style={{ fontSize: 28, lineHeight: '34px' }}>
              {rupees(n0(rev.mrrEstimateInr))}
            </div>
            <Delta d={deltaOf(rev.mrrEstimateInr, revPrev.mrrEstimateInr)} />
          </div>
          <div className="divider" />
          <div className="stack" style={{ gap: 8 }}>
            {[
              ['Plus', rev.plus, prices.plusInr],
              ['Pro', rev.pro, prices.proInr],
              ['Venue plans', rev.venuePlans, prices.venueInr],
            ].map(([name, count, price]) => (
              <div key={name} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label">{name}</span>
                <span className="soft" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {num(n0(count))} × {isNum(price) ? rupees(price) : 'n/a'}
                </span>
              </div>
            ))}
            {n0(rev.granted) > 0 ? <span className="caption muted">{num(rev.granted)} complimentary plans not counted.</span> : null}
          </div>
          <p className="caption muted" style={{ margin: '12px 0 0' }}>
            Estimate only: active paid plans times the monthly list price, before store fees and GST.
          </p>
        </section>

        <section className="card viz-card">
          <div className="viz-head">
            <div>
              <h2 className="h3">Safety</h2>
              <div className="caption muted viz-sub">Reports and blocks in this range</div>
            </div>
            <TileLink href="/admin/reports">Reports</TileLink>
          </div>
          <div className="facts">
            <Fact label="Open reports" value={num(n0(safety.openReports))} sub={urgent ? `${num(urgent)} urgent` : null} />
            <Fact label="Median time to resolve" value={isNum(safety.medianHoursToResolve) ? `${safety.medianHoursToResolve} h` : 'n/a'} sub={n0(safety.resolved) ? `${num(safety.resolved)} resolved` : 'None resolved yet'} />
            <Fact label="Blocks" value={num(n0(safety.blocks))} />
            <Fact label="Reports filed" value={num(n0(t.reports))} />
          </div>
          <div className="divider" />
          {reasons.length ? <HBarList stacked items={reasons.slice(0, 5)} color={SERIES[0]} label="Reports by reason" /> : <ChartEmpty title="No reports in this range" />}
        </section>
      </div>
    </div>
  );
}
