// circle_challenge — shared group milestone. Only verified meetups count.
// Progress up front; contributors below; the counting rules fold away.
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Button, Card, Icon, Mascot, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import IconBubble from '@/features/system/IconBubble';
import { personById } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, glass, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import { circleAccent } from './components/CircleCard';
import { normalizeChallenge } from './circleUtils';

const RULES = [
  { icon: 'check-circle', tone: 'mint', text: 'Counts when the host and one attendee confirm it.' },
  { icon: 'repeat', tone: 'lavender', text: 'Each plan counts once, however many attend.' },
  { icon: 'heart', tone: 'pink', text: 'No pressure. Missing it never affects your standing.' },
];

export default function CircleChallengeScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const id = route.params?.id;
  const circles = useAppStore((s) => s.circles);
  const joinedCircles = useAppStore((s) => s.joinedCircles);
  const raw = useAppStore((s) => s.circleChallenges[id]);
  const joinCircle = useAppStore((s) => s.joinCircle);
  const joinCircleChallenge = useAppStore((s) => s.joinCircleChallenge);
  const [celebrate, setCelebrate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [howOpen, setHowOpen] = useState(false);

  const load = useLoader(`circleChallenge:${id}`, (s) => s.loadCircleChallenge(id), [id]);
  useLoader(`circle:${id}`, (s) => (s.circles.some((x) => x.id === id) ? null : s.loadCircle(id)), [id]);

  const c = useMemo(() => circles.find((x) => x.id === id), [circles, id]);
  const ch = useMemo(() => normalizeChallenge(raw), [raw]);
  const joined = joinedCircles.includes(id);
  const inChallenge = !!ch?.joined;

  if (!c || !ch) {
    return (
      <Screen header={<ScreenHeader title="Challenge" />}>
        <QueryState
          status={load.status}
          error={load.error}
          hasData={false}
          onRetry={load.reload}
          skeletonRows={2}
          skeletonHeight={160}
          empty={{ title: 'No challenge right now', body: 'This circle has no active group challenge.', cta: 'Back', onCta: () => nav.goBack() }}
          style={{ marginTop: space.md }}
        />
      </Screen>
    );
  }

  const pct = Math.round((ch.progress / ch.goal) * 100);
  const toGo = Math.max(0, ch.goal - ch.progress);
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!joined) await joinCircle(c.id);
      await joinCircleChallenge(c.id);
      setCelebrate(Date.now());
      haptics.success();
    } catch (e) {
      setError(e?.message || 'Could not join the challenge. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      bg={colors.canvas}
      header={<ScreenHeader title="Group challenge" subtitle={c.name} />}
      footer={
        <View>
          {!!error && (
            <AppText variant="caption" color={colors.danger} align="center" style={{ marginBottom: space.xs }} accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          {inChallenge ? (
            <Button title="Plan a circle meetup" icon="plus" onPress={() => nav.navigate('circle_detail', { id: c.id })} />
          ) : (
            <Button title={joined ? 'Join the challenge' : 'Join circle & challenge'} onPress={join} loading={busy} disabled={ch.completed} />
          )}
        </View>
      }
    >
      {/* Progress: the one thing this screen is about */}
      <Animated.View entering={enter(0)} style={{ backgroundColor: circleAccent(c), borderRadius: radius.hero, padding: space.lg, alignItems: 'center', marginTop: space.xs }}>
        <Mascot size={120} mood={celebrate ? 'celebrate' : 'idle'} celebrateKey={celebrate} />
        <AppText variant="h2" align="center" style={{ marginTop: space.sm }} accessibilityRole="header">
          {ch.title}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} align="center" style={{ marginTop: space.xxs }} numberOfLines={2}>
          {ch.subtitle}
        </AppText>
        <View style={{ alignSelf: 'stretch', marginTop: space.lg }}>
          <ProgressBar value={ch.progress / ch.goal} height={12} track={glass(0.7)} accessibilityLabel={`${ch.progress} of ${ch.goal} meetups`} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xs, gap: space.xs }}>
            <AppText variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
              {ch.progress}/{ch.goal} meetups · {pct}%
            </AppText>
            {ch.daysLeft != null && (
              <AppText variant="label" numberOfLines={1}>
                {ch.daysLeft === 1 ? '1 day left' : `${ch.daysLeft} days left`}
              </AppText>
            )}
          </View>
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%', backgroundColor: inChallenge ? colors.ink : colors.surface, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xs, marginTop: space.md }}
          accessibilityLiveRegion="polite"
        >
          <Icon name={inChallenge ? 'check' : ch.completed ? 'trophy' : 'target'} size={14} color={inChallenge ? colors.white : colors.ink} />
          <AppText variant="label" color={inChallenge ? colors.white : colors.ink} numberOfLines={1} style={{ marginLeft: space.xxs, flexShrink: 1 }}>
            {[inChallenge ? "You're in" : ch.completed ? 'Goal reached' : `${toGo} to go`, ch.rewardXp ? `+${ch.rewardXp} XP each` : null].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </Animated.View>

      <SectionHeader title="Top contributors" />
      <Card>
        {ch.contributors.length === 0 ? (
          <AppText color={colors.muted}>No meetups yet. Host the first one!</AppText>
        ) : (
          ch.contributors.map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: i ? space.xs : 0 }}>
              <AppText variant="label" color={i === 0 ? colors.deep : colors.muted} align="center" style={{ width: 20, marginRight: space.xs }}>
                {i + 1}
              </AppText>
              <Avatar seed={p.id} uri={personById[p.id]?.avatarUrl} size={36} />
              <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1, marginHorizontal: space.sm }}>
                {p.name}
              </AppText>
              <AppText variant="label" color={colors.inkSoft}>
                {p.count === 1 ? '1 meetup' : `${p.count} meetups`}
              </AppText>
            </View>
          ))
        )}
      </Card>

      {/* Fine print: one tap away */}
      <View style={{ marginTop: space.xl, backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
        <Pressable
          onPress={() => setHowOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: howOpen }}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56 }}
        >
          <Icon name="info" size={18} color={colors.ink} />
          <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm }}>
            How it works
          </AppText>
          <Icon name={howOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
        </Pressable>
        {howOpen && (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: space.sm, gap: space.sm }}>
            {RULES.map((r) => (
              <View key={r.text} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <IconBubble icon={r.icon} tone={r.tone} size={32} iconSize={16} />
                <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
                  {r.text}
                </AppText>
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
