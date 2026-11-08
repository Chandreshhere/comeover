// circle_challenge — shared group milestone. Only verified meetups count.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Avatar, Button, Card, Icon, Mascot, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader } from '@/components';
import { personById } from '@/data/catalog';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import haptics from '@/utils/haptics';
import { circleAccent } from './components/CircleCard';
import { normalizeChallenge } from './circleUtils';

const RULES = [
  { icon: 'check-circle', text: 'Only plans confirmed by the host and at least one attendee count.' },
  { icon: 'repeat', text: 'Each plan counts once, no matter how many people attend.' },
  { icon: 'heart', text: 'No pressure: missing it never affects your access or standing.' },
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
            <Button title="Plan a meetup for the circle" icon="plus" onPress={() => nav.navigate('circle_detail', { id: c.id })} />
          ) : (
            <Button title={joined ? 'Join the challenge' : 'Join circle & challenge'} onPress={join} loading={busy} disabled={ch.completed} />
          )}
        </View>
      }
    >
      <Animated.View entering={enter(0)} style={{ backgroundColor: circleAccent(c), borderRadius: radius.hero, padding: space.lg, alignItems: 'center' }}>
        <Mascot size={150} mood={celebrate ? 'celebrate' : 'idle'} celebrateKey={celebrate} />
        <AppText variant="h2" align="center" style={{ marginTop: space.sm }} accessibilityRole="header">
          {ch.title}
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} align="center" style={{ marginTop: 4 }}>
          {ch.subtitle}
        </AppText>
        <View style={{ alignSelf: 'stretch', marginTop: space.lg }}>
          <ProgressBar value={ch.progress / ch.goal} height={12} track="rgba(255,255,255,0.7)" accessibilityLabel={`${ch.progress} of ${ch.goal} meetups`} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <AppText variant="label">
              {ch.progress}/{ch.goal} meetups · {pct}%
            </AppText>
            {ch.daysLeft != null && <AppText variant="label">{ch.daysLeft} days left</AppText>}
          </View>
        </View>
        {inChallenge && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginTop: space.md }} accessibilityLiveRegion="polite">
            <Icon name="check" size={14} color={colors.white} />
            <AppText variant="label" color={colors.white} style={{ marginLeft: 6 }}>
              You're in — every verified meetup counts
            </AppText>
          </View>
        )}
      </Animated.View>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        {ch.rewardXp ? (
          <Card style={{ flex: 1, alignItems: 'center' }}>
            <AppText variant="h2">+{ch.rewardXp}</AppText>
            <AppText variant="caption" color={colors.muted}>
              XP each when hit
            </AppText>
          </Card>
        ) : null}
        <Card style={{ flex: 1, alignItems: 'center' }}>
          <AppText variant="h2">{ch.goal - ch.progress}</AppText>
          <AppText variant="caption" color={colors.muted}>
            meetups to go
          </AppText>
        </Card>
      </View>

      <SectionHeader title="Top contributors" />
      <Card>
        {ch.contributors.length === 0 && <AppText color={colors.muted}>No meetups yet — host the first one!</AppText>}
        {ch.contributors.map((p, i) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: i ? space.sm : 0 }}>
            <AppText variant="label" color={colors.muted} style={{ width: 20 }}>
              {i + 1}
            </AppText>
            <Avatar seed={p.id} uri={personById[p.id]?.avatarUrl} size={36} />
            <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm }}>
              {p.name}
            </AppText>
            <AppText variant="label">{p.count} meetups</AppText>
          </View>
        ))}
      </Card>

      <SectionHeader title="How it works" />
      <Card>
        {RULES.map((r, i) => (
          <View key={r.text} style={{ flexDirection: 'row', marginTop: i ? space.sm : 0 }}>
            <Icon name={r.icon} size={16} color={colors.deep} style={{ marginTop: 3 }} />
            <AppText style={{ flex: 1, marginLeft: space.sm }}>{r.text}</AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
