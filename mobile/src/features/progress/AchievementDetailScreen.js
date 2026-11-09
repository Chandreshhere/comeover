// achievement_detail — the badge, how to earn it (with progress or evidence)
// and a short list of ways to make progress.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Card, EmptyState, Icon, ListGroup, ListRow, Pictogram, ProgressBar, ProgressRing, QueryState, Screen, ScreenHeader, SectionHeader, Tag } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { categoryBySlug } from '@/data/catalog';
import { monthShort } from '@/utils/format';
import { badgeColor } from './components/RoadmapPath';

// Discovery shortcuts come from the badge itself (server fields):
//   category: slug that counts · kind: 'host' | 'explore' · hint: short tip
const helpFor = (a) => ({
  category: a.category || null,
  explore: a.kind === 'explore',
  host: a.kind === 'host',
  note: a.hint || null,
});

const MEDAL = 128;

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear()}`;
};

export default function AchievementDetailScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const achievements = useAppStore((s) => s.achievements);
  const achievementsL = useLoader('achievements', (s) => s.loadAchievements());
  const a = useMemo(() => achievements.find((x) => x.id === route.params?.id), [achievements, route.params?.id]);

  if (!a) {
    return (
      <Screen header={<ScreenHeader title="Badge" />}>
        <QueryState status={achievementsL.status} error={achievementsL.error} hasData={false} onRetry={achievementsL.reload} skeletonRows={2} skeletonHeight={160}>
          <EmptyState title="Badge not found" body="It may have been retired. Your progress is safe." cta="All achievements" onCta={() => nav.navigate('achievements')} />
        </QueryState>
      </Screen>
    );
  }

  const help = helpFor(a);
  const cat = help.category ? categoryBySlug[help.category] : null;
  const bg = a.earned ? badgeColor(a.color) : colors.surfaceSubtle;
  const total = Number(a.total) || 0;
  const prog = Math.min(Number(a.progress) || 0, total);

  return (
    <Screen header={<ScreenHeader title="Badge" />}>
      <Animated.View entering={enter(0)} style={{ alignItems: 'center', marginTop: space.md }}>
        <View style={{ width: MEDAL + 20, height: MEDAL + 20, alignItems: 'center', justifyContent: 'center' }}>
          {!a.earned && total > 0 ? (
            <View style={{ position: 'absolute' }}>
              <ProgressRing value={prog / total} size={MEDAL + 20} stroke={6} color={colors.deep} track={colors.track} />
            </View>
          ) : null}
          <View style={{ width: MEDAL, height: MEDAL, borderRadius: MEDAL / 2, backgroundColor: bg, borderWidth: a.earned ? 4 : 2, borderColor: a.earned ? colors.ink : colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name={a.pictogram} size={Math.round(MEDAL * 0.46)} color={a.earned ? colors.ink : colors.muted} />
          </View>
        </View>
        <AppText variant="h1" align="center" style={{ marginTop: space.md }} accessibilityRole="header">
          {a.title}
        </AppText>
        <Tag
          style={{ alignSelf: 'center', marginTop: space.xs }}
          label={a.earned ? (a.earnedAt ? `Earned ${fmtDate(a.earnedAt)}` : 'Earned') : total ? `In progress · ${prog}/${total}` : 'Not earned yet'}
          icon={a.earned ? 'check' : 'lock'}
          bg={a.earned ? colors.mint : colors.surface}
          fg={colors.ink}
        />
      </Animated.View>

      <Animated.View entering={enter(1)}>
        <SectionHeader title="How to earn it" />
        <Card>
          <AppText>{a.criteria}</AppText>
          {!a.earned && total ? (
            <>
              <ProgressBar value={prog / total} style={{ marginTop: space.md }} accessibilityLabel={`${prog} of ${total}`} />
              <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.xs }}>
                {prog}/{total} · {total - prog} more to go
              </AppText>
            </>
          ) : null}
          {a.earned ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
              <Icon name="shield" size={16} color={colors.success} weight="duotone" />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
                From {a.evidence || 'verified meetups'}, confirmed by the host and a guest
              </AppText>
            </View>
          ) : null}
          {help.note ? (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
              {help.note}
            </AppText>
          ) : null}
        </Card>
      </Animated.View>

      <SectionHeader title={a.earned ? 'Keep it going' : 'Make progress'} />
      <ListGroup>
        {cat && <ListRow icon="search" title={`Find a ${cat.short.toLowerCase()} plan`} subtitle="Nearby, starting soon" onPress={() => nav.navigate('category_results', { category: cat.slug })} />}
        {help.explore && <ListRow icon="compass" title="Try something new" subtitle="Categories you haven’t done" onPress={() => nav.navigate('discover_search')} />}
        {help.host && <ListRow icon="plus-circle" title="Host a plan" subtitle="Takes under a minute" onPress={() => nav.navigate('create_activity_type')} />}
        <ListRow icon="message-circle" title="Ask Mo for ideas" onPress={() => nav.navigate('plan_assistant')} />
        <ListRow icon="award" title="All achievements" onPress={() => nav.navigate('achievements')} last />
      </ListGroup>
    </Screen>
  );
}
