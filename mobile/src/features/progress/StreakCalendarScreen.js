// streak_calendar — consistency calendar with weekly goals, rest days and
// a freeze. Weekly by default; daily streak is opt-in. Never shames misses.
// Data: GET /me/streak-calendar?months=3 → { days:[{date:'YYYY-MM-DD', state}], weeks:[{start, done, goal, froze?}] }
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { AppText, Button, Card, HeroCard, Icon, IconButton, ListGroup, ListRow, Pictogram, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, layout, radius, space } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { monthShort, weekdayShort } from '@/utils/format';
import haptics from '@/utils/haptics';
import { ActionError, errorText } from './components/progressShared';

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KNOWN_STATES = new Set(['done', 'rest', 'freeze', 'missed', 'none']);
const MONTHS_REQUESTED = 3;

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

const CELL_STYLE = {
  done: { bg: colors.ink, fg: colors.white },
  today_done: { bg: colors.orange, fg: colors.ink, border: colors.ink },
  today: { bg: colors.white, fg: colors.ink, border: colors.orange },
  rest: { bg: colors.lavender, fg: colors.inkSoft },
  freeze: { bg: colors.periwinkleWash, fg: colors.deep, border: colors.deep },
  missed: { bg: 'transparent', fg: colors.inkSoft },
  future: { bg: 'transparent', fg: colors.muted },
  none: { bg: 'transparent', fg: colors.border },
};

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
  const st = CELL_STYLE[cell.state] || CELL_STYLE.none;
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
          <Icon name="shield" size={inner * 0.4} color={st.fg} />
        ) : (
          <AppText variant="caption" color={st.fg} style={cell.isToday ? { fontFamily: 'Poppins-Bold' } : null}>
            {cell.state === 'rest' ? 'z' : cell.n}
          </AppText>
        )}
      </Animated.View>
    </View>
  );
}

function Legend({ color, border, label, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: space.md, marginBottom: 6 }}>
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

  return (
    <Screen
      header={<ScreenHeader title="Streak" subtitle="Weekly goals, your pace" />}
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
      <HeroCard>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="zap" size={28} color={colors.orange} />
          </View>
          <View style={{ flex: 1, marginLeft: space.md }}>
            <AppText variant="display">
              {progress.streakWeeks} week{progress.streakWeeks === 1 ? '' : 's'}
            </AppText>
            <AppText variant="label" color={colors.inkSoft}>
              Weekly goal: {progress.weeklyGoal} verified meetups
            </AppText>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.md }}>
          <View style={{ flex: 1, backgroundColor: colors.glass, borderRadius: radius.quest, padding: space.sm }}>
            <AppText variant="caption" color={colors.inkSoft}>
              This week
            </AppText>
            <AppText variant="h3">
              {Math.min(progress.weeklyDone, progress.weeklyGoal)}/{progress.weeklyGoal}
            </AppText>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.glass, borderRadius: radius.quest, padding: space.sm }}>
            <AppText variant="caption" color={colors.inkSoft}>
              Freezes left
            </AppText>
            <AppText variant="h3">{progress.freezesLeft}</AppText>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.glass, borderRadius: radius.quest, padding: space.sm }}>
            <AppText variant="caption" color={colors.inkSoft}>
              {offset === 0 ? 'This month' : monthShort[view.getMonth()]}
            </AppText>
            <AppText variant="h3">{calendar ? monthDone : '—'}</AppText>
          </View>
        </View>
      </HeroCard>

      {/* Calendar */}
      <QueryState status={calendarL.status} error={calendarL.error} hasData={!!calendar} onRetry={calendarL.reload} skeletonRows={1} skeletonHeight={300} style={{ marginTop: space.md }}>
        <Card style={{ marginTop: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm }}>
            <IconButton icon="chevron-left" size={40} accessibilityLabel="Previous month" onPress={() => setOffset((o) => Math.max(oldestOffset, o - 1))} style={{ opacity: offset <= oldestOffset ? 0.3 : 1 }} />
            <AppText variant="h3" accessibilityRole="header">
              {MONTH_FULL[view.getMonth()]} {view.getFullYear()}
            </AppText>
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm }}>
            <Legend color={colors.ink} label="Meetup">
              <Pictogram name="check" size={9} color={colors.white} strokeWidth={4} />
            </Legend>
            <Legend color={colors.lavender} label="Rest day" />
            <Legend color={colors.periwinkleWash} border={colors.deep} label="Freeze" />
            <Legend color={colors.white} border={colors.orange} label="Today" />
          </View>
          {serverDays.length === 0 ? (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
              Your calendar fills in as you complete verified meetups.
            </AppText>
          ) : null}
        </Card>
      </QueryState>

      {/* Weeks */}
      {weeks.length > 0 && (
        <>
          <SectionHeader title="Weekly goals" />
          <Card style={{ paddingVertical: 4 }}>
            {weeks.map((w, i) => {
              const met = w.done >= w.goal;
              return (
                <View key={w.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i === weeks.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: met ? colors.mint : w.froze ? colors.periwinkleWash : colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={met ? 'check' : w.froze ? 'shield' : w.current ? 'clock' : 'minus'} size={16} color={met ? colors.success : colors.inkSoft} />
                  </View>
                  <View style={{ flex: 1, marginLeft: space.sm }}>
                    <AppText variant="bodyStrong">
                      Week of {w.from.getDate()} {monthShort[w.from.getMonth()]}
                    </AppText>
                    <AppText variant="caption" color={colors.muted}>
                      {w.current ? 'In progress · ' : ''}
                      {w.done} meetup{w.done === 1 ? '' : 's'}
                      {met ? ' · goal met' : w.froze ? ' · protected by a freeze' : w.current ? '' : ' · a lighter week'}
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

      {/* Controls */}
      <SectionHeader title="Your rules" />
      <ListGroup>
        <ListRow
          icon="sun"
          title="Daily streak (optional)"
          subtitle="Off by default. Weekly goals already keep your streak."
          toggle={!!dailyOptIn}
          onToggle={(v) => {
            haptics.select();
            setPrefs({ dailyStreakOptIn: v });
          }}
        />
        <ListRow icon="moon" title="Rest days" subtitle="Any day without a plan is a rest day — they never break a streak." last />
      </ListGroup>

      <Card style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center' }} bg={colors.periwinkleWash} elevated={false}>
        <Icon name="shield" size={22} color={colors.deep} />
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <AppText variant="bodyStrong">Streak freeze</AppText>
          <AppText variant="caption" color={colors.inkSoft}>
            {progress.freezesLeft > 0 ? (canFreeze ? 'Cover a quiet day this week.' : 'Nothing to cover right now.') : 'You get a new freeze each month.'}
          </AppText>
        </View>
        <Button title="Use" size="xs" full={false} disabled={!canFreeze || freezing} loading={freezing} onPress={freeze} />
      </Card>
      <ActionError message={actionError} onDismiss={() => setActionError(null)} />

      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.lg }}>
        Life happens. Missing a week never limits what you can do in Project IRL.
      </AppText>
    </Screen>
  );
}
