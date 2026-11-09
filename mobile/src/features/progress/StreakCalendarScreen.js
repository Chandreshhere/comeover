// streak_calendar — streak summary (with the freeze), month calendar, recent
// weekly goals and the one optional setting. Weekly by default; daily streak
// is opt-in. Never shames misses.
// Data: GET /me/streak-calendar?months=3 → { days:[{date:'YYYY-MM-DD', state}], weeks:[{start, done, goal, froze?}] }
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Snowflake } from 'phosphor-react-native/src/icons/Snowflake';
import { AppText, Button, Card, HeroCard, Icon, IconBubble, IconButton, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, fonts, layout, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { monthShort, weekdayShort } from '@/utils/format';
import haptics from '@/utils/haptics';
import { ActionError, errorText } from './components/progressShared';

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KNOWN_STATES = new Set(['done', 'rest', 'freeze', 'missed', 'none']);
const MONTHS_REQUESTED = 3;
const WEEKS_PREVIEW = 4;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function parseYmd(s) {
  const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function normaliseState(s) {
  if (s === 'today_done') return 'done';
  return KNOWN_STATES.has(s) ? s : 'none';
}

function buildMonth(year, month, dayStates, today) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const t = startOfDay(today);
  const cells = Array.from({ length: first.getDay() }, () => null);
  for (let n = 1; n <= days; n++) {
    const d = new Date(year, month, n);
    const server = dayStates[ymd(d)];
    const isToday = d.getTime() === t.getTime();
    let state;
    if (d > t) state = 'future';
    else if (isToday) state = server === 'done' || server === 'today_done' ? 'today_done' : server === 'rest' || server === 'freeze' ? server : 'today';
    else state = server ? normaliseState(server) : 'none';
    cells.push({ date: d, n, state, isToday });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

// Function, not a constant: reads the live (light/dark) palette.
const cellStyles = () => ({
  done: { bg: colors.ink, fg: colors.white },
  today_done: { bg: colors.orange, fg: colors.ink, border: colors.ink },
  today: { bg: colors.surface, fg: colors.ink, border: colors.orange },
  rest: { bg: colors.lavender, fg: colors.inkSoft },
  freeze: { bg: colors.periwinkleWash, fg: colors.deep, border: colors.deep },
  missed: { bg: 'transparent', fg: colors.inkSoft },
  future: { bg: 'transparent', fg: colors.muted },
  none: { bg: 'transparent', fg: colors.muted },
});

const LABEL = { done: 'verified meetup', today_done: 'today, meetup verified', today: 'today', rest: 'rest day', freeze: 'freeze used', missed: 'no meetup', future: 'upcoming', none: 'no data' };

function DayCell({ cell, size }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (!cell || reduce || cell.state !== 'today_done') return;
    // streak_increment: one pulse when today's meetup is verified.
    s.value = withSequence(withTiming(1.2, { duration: durations.streak / 2 }), withSpring(1, spring));
  }, [cell?.state, reduce]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  if (!cell) return <View style={{ width: size, height: size }} />;
  const all = cellStyles();
  const st = all[cell.state] || all.none;
  const inner = size - 8;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={`${cell.n} ${monthShort[cell.date.getMonth()]}, ${LABEL[cell.state]}`}>
      <Animated.View
        style={[
          { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: st.bg, borderWidth: st.border ? 2 : 0, borderColor: st.border, alignItems: 'center', justifyContent: 'center' },
          a,
        ]}
      >
        {cell.state === 'done' || cell.state === 'today_done' ? (
          <Pictogram name="check" size={inner * 0.5} color={st.fg} strokeWidth={3} />
        ) : cell.state === 'freeze' ? (
          <Snowflake size={inner * 0.42} color={st.fg} weight="bold" />
        ) : cell.state === 'rest' ? (
          <Icon name="moon" size={inner * 0.42} color={st.fg} weight="duotone" />
        ) : (
          <AppText variant="caption" color={st.fg} style={[{ opacity: cell.state === 'none' ? 0.6 : 1 }, cell.isToday ? { fontFamily: fonts.bold } : null]}>
            {cell.n}
          </AppText>
        )}
      </Animated.View>
    </View>
  );
}

function Legend({ color, border, label, children }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color, borderWidth: border ? 1.5 : 0, borderColor: border, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
      <AppText variant="caption" color={colors.inkSoft} style={{ marginLeft: 6 }}>
        {label}
      </AppText>
    </View>
  );
}

export default function StreakCalendarScreen() {
  const { width } = useWindowDimensions();
  const progress = useAppStore((s) => s.progress);
  const calendar = useAppStore((s) => s.streakCalendar);
  const dailyOptIn = useAppStore((s) => s.prefs.dailyStreakOptIn);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const applyStreakFreeze = useAppStore((s) => s.applyStreakFreeze);
  const calendarL = useLoader('streakCalendar', (s) => s.loadStreakCalendar(MONTHS_REQUESTED));
  const progressL = useLoader('progress', (s) => s.loadProgress());
  const [offset, setOffset] = useState(0);
  const [allWeeks, setAllWeeks] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [actionError, setActionError] = useState(null);

  const today = useMemo(() => new Date(), []);
  const serverDays = useMemo(() => (Array.isArray(calendar?.days) ? calendar.days : []), [calendar]);
  const dayStates = useMemo(() => Object.fromEntries(serverDays.filter((d) => d?.date).map((d) => [String(d.date).slice(0, 10), d.state])), [serverDays]);

  // Oldest month we can page back to = the earliest day the server returned.
  const oldestOffset = useMemo(() => {
    const dates = serverDays.map((d) => parseYmd(d.date)).filter(Boolean);
    if (!dates.length) return -(MONTHS_REQUESTED - 1);
    const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
    return Math.min(0, -((today.getFullYear() - earliest.getFullYear()) * 12 + (today.getMonth() - earliest.getMonth())));
  }, [serverDays, today]);

  const view = useMemo(() => new Date(today.getFullYear(), today.getMonth() + offset, 1), [today, offset]);
  const cells = useMemo(() => buildMonth(view.getFullYear(), view.getMonth(), dayStates, today), [view, dayStates, today]);
  const rows = useMemo(() => Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7)), [cells]);
  const cellSize = Math.floor((width - layout.screenPadding * 2 - space.md * 2) / 7);

  const weeks = useMemo(() => {
    const list = Array.isArray(calendar?.weeks) ? calendar.weeks : [];
    const t = startOfDay(today).getTime();
    return list
      .map((w) => {
        const from = parseYmd(w.start);
        if (!from) return null;
        const end = new Date(from);
        end.setDate(end.getDate() + 7);
        return {
          key: String(w.start),
          from,
          done: w.done ?? 0,
          goal: w.goal ?? progress.weeklyGoal,
          froze: !!(w.froze || w.frozen),
          current: t >= from.getTime() && t < end.getTime(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.from - a.from);
  }, [calendar, today, progress.weeklyGoal]);

  const monthDone = cells.filter((c) => c && (c.state === 'done' || c.state === 'today_done')).length;
  const currentWeekMissed = (progress.week || []).some((d) => d.state === 'missed');
  const canFreeze = progress.freezesLeft > 0 && currentWeekMissed;

  const freeze = async () => {
    if (freezing) return;
    setFreezing(true);
    setActionError(null);
    try {
      await applyStreakFreeze();
      haptics.success();
      calendarL.reload();
    } catch (e) {
      setActionError(errorText(e, 'Couldn’t use your freeze. Try again.'));
    } finally {
      setFreezing(false);
    }
  };

  const streak = progress.streakWeeks ?? 0;
  const goal = progress.weeklyGoal ?? 0;
  const freezes = progress.freezesLeft ?? 0;
  const shownWeeks = allWeeks ? weeks : weeks.slice(0, WEEKS_PREVIEW);

  return (
    <Screen
      header={<ScreenHeader title="Streak" />}
      refreshControl={
        <RefreshControl
          refreshing={calendarL.refreshing || progressL.refreshing}
          onRefresh={() => {
            calendarL.reload();
            progressL.reload();
          }}
          tintColor={colors.ink}
        />
      }
    >
      {/* Summary + freeze */}
      <HeroCard style={{ marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconBubble size={52} tone="surface" icon="fire" iconSize={28} duo={colors.orange} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h1" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {streak}-week streak
            </AppText>
            <AppText variant="caption" color={colors.inkSoft}>
              {Math.min(progress.weeklyDone ?? 0, goal)} of {goal} meetups this week
            </AppText>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, minHeight: 32 }}>
          <Snowflake size={16} color={colors.ink} weight="bold" />
          <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }}>
            {freezes} freeze{freezes === 1 ? '' : 's'} left
          </AppText>
          {canFreeze ? <Button title="Use freeze" size="xs" variant="light" full={false} loading={freezing} disabled={freezing} onPress={freeze} /> : null}
        </View>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xxs }}>
          Rest days never break a streak.
        </AppText>
      </HeroCard>
      <ActionError message={actionError} onDismiss={() => setActionError(null)} />

      {/* Calendar */}
      <QueryState status={calendarL.status} error={calendarL.error} hasData={!!calendar} onRetry={calendarL.reload} skeletonRows={1} skeletonHeight={300} style={{ marginTop: space.xl }}>
        <Card style={{ marginTop: space.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
            <IconButton icon="chevron-left" size={40} accessibilityLabel="Previous month" onPress={() => setOffset((o) => Math.max(oldestOffset, o - 1))} style={{ opacity: offset <= oldestOffset ? 0.3 : 1 }} />
            <View style={{ alignItems: 'center' }}>
              <AppText variant="h3" accessibilityRole="header">
                {MONTH_FULL[view.getMonth()]} {view.getFullYear()}
              </AppText>
              <AppText variant="caption" color={colors.muted}>
                {calendar ? monthDone : 0} meetup{monthDone === 1 ? '' : 's'}
              </AppText>
            </View>
            <IconButton icon="chevron-right" size={40} accessibilityLabel="Next month" onPress={() => setOffset((o) => Math.min(0, o + 1))} style={{ opacity: offset >= 0 ? 0.3 : 1 }} />
          </View>
          <View style={{ flexDirection: 'row' }}>
            {weekdayShort.map((d) => (
              <AppText key={d} variant="caption" color={colors.muted} align="center" style={{ width: cellSize }}>
                {d[0]}
              </AppText>
            ))}
          </View>
          {rows.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row' }}>
              {r.map((c, j) => (
                <DayCell key={j} cell={c} size={cellSize} />
              ))}
            </View>
          ))}
          <View style={{ gap: space.xs, marginTop: space.sm }}>
            <View style={{ flexDirection: 'row' }}>
              <Legend color={colors.ink} label="Meetup">
                <Pictogram name="check" size={9} color={colors.white} strokeWidth={4} />
              </Legend>
              <Legend color={colors.lavender} label="Rest day">
                <Icon name="moon" size={9} color={colors.inkSoft} weight="fill" />
              </Legend>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Legend color={colors.periwinkleWash} border={colors.deep} label="Freeze" />
              <Legend color={colors.surface} border={colors.orange} label="Today" />
            </View>
          </View>
          {serverDays.length === 0 ? (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
              Fills in as you complete verified meetups.
            </AppText>
          ) : null}
        </Card>
      </QueryState>

      {/* Weeks */}
      {weeks.length > 0 && (
        <>
          <SectionHeader
            title="Weekly goals"
            action={weeks.length > WEEKS_PREVIEW ? (allWeeks ? 'Show less' : 'Show all') : undefined}
            onAction={() => setAllWeeks((v) => !v)}
          />
          <Card style={{ paddingVertical: space.xxs }}>
            {shownWeeks.map((w, i) => {
              const met = w.done >= w.goal;
              return (
                <View
                  key={w.key}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: space.xs, borderBottomWidth: i === shownWeeks.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: met ? colors.mint : w.froze ? colors.periwinkleWash : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                    {w.froze && !met ? (
                      <Snowflake size={16} color={colors.deep} weight="bold" />
                    ) : (
                      <Icon name={met ? 'check' : w.current ? 'clock' : 'minus'} size={16} color={met ? colors.success : colors.inkSoft} />
                    )}
                  </View>
                  <View style={{ flex: 1, marginLeft: space.sm }}>
                    <AppText variant="bodyStrong">
                      Week of {w.from.getDate()} {monthShort[w.from.getMonth()]}
                    </AppText>
                    <AppText variant="caption" color={colors.muted}>
                      {w.current ? 'In progress' : met ? 'Goal met' : w.froze ? 'Covered by a freeze' : 'A lighter week'}
                    </AppText>
                  </View>
                  <AppText variant="label">
                    {Math.min(w.done, w.goal)}/{w.goal}
                  </AppText>
                </View>
              );
            })}
          </Card>
        </>
      )}

      {/* Setting */}
      <SectionHeader title="Settings" />
      <ListGroup>
        <ListRow
          icon="sun"
          title="Daily streak"
          subtitle="Optional. Weekly goals already count."
          toggle={!!dailyOptIn}
          onToggle={(v) => {
            haptics.select();
            setPrefs({ dailyStreakOptIn: v });
          }}
          last
        />
      </ListGroup>
    </Screen>
  );
}
