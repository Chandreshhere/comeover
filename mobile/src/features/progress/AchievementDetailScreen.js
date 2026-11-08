// achievement_detail — badge criteria and earned evidence / progress.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Card, EmptyState, ListGroup, ListRow, Pictogram, PictogramCluster, ProgressBar, QueryState, Screen, ScreenHeader, SectionHeader, Tag } from '@/components';
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

  return (
    <Screen bg={a.earned ? colors.periwinkle : colors.canvas} header={<ScreenHeader title="Badge" variant={a.earned ? 'glass' : 'surface'} />}>
      <Animated.View entering={enter(0)} style={{ alignItems: 'center', marginTop: space.md }}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          {a.earned && (
            <View style={{ position: 'absolute', top: -20 }}>
              <PictogramCluster width={300} height={90} color="rgba(9,10,14,0.5)" />
            </View>
          )}
          <View style={{ width: 150, height: 150, borderRadius: 75, backgroundColor: bg, borderWidth: 5, borderColor: a.earned ? colors.ink : colors.border, alignItems: 'center', justifyContent: 'center', marginTop: space.lg }}>
            <Pictogram name={a.pictogram} size={72} color={a.earned ? colors.ink : colors.muted} />
          </View>
        </View>
        <AppText variant="display" align="center" style={{ marginTop: space.lg }} accessibilityRole="header">
          {a.title}
        </AppText>
        <Tag
          style={{ alignSelf: 'center', marginTop: space.xs }}
          label={a.earned ? `Earned ${a.earnedAt ? fmtDate(a.earnedAt) : ''}` : `In progress · ${a.progress || 0}/${a.total}`}
          icon={a.earned ? 'check' : 'clock'}
          bg={a.earned ? colors.ink : colors.surface}
          fg={a.earned ? colors.white : colors.inkSoft}
        />
      </Animated.View>

      <Animated.View entering={enter(1)}>
        <SectionHeader title="How to earn it" />
        <Card>
          <AppText>{a.criteria}</AppText>
          {!a.earned && a.total ? (
            <>
              <ProgressBar value={(a.progress || 0) / a.total} style={{ marginTop: space.md }} accessibilityLabel={`${a.progress || 0} of ${a.total}`} />
              <AppText variant="caption" color={colors.muted} style={{ marginTop: 6 }}>
                {a.total - (a.progress || 0)} more to go
              </AppText>
            </>
          ) : null}
          {help.note ? (
            <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
              {help.note}
            </AppText>
          ) : null}
        </Card>
      </Animated.View>

      {a.earned && (
        <Animated.View entering={enter(2)}>
          <SectionHeader title="Earned from" />
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
              <Pictogram name="shield" size={22} />
            </View>
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="bodyStrong">{a.evidence || 'Verified meetups'}</AppText>
              <AppText variant="caption" color={colors.muted}>
                Verified by host + attendee confirmation
              </AppText>
            </View>
          </Card>
        </Animated.View>
      )}

      <SectionHeader title={a.earned ? 'Keep it going' : 'Ways to make progress'} />
      <ListGroup>
        {cat && <ListRow icon="search" title={`Find a ${cat.short.toLowerCase()} plan`} subtitle="Nearby, starting soon" onPress={() => nav.navigate('category_results', { category: cat.slug })} />}
        {help.explore && <ListRow icon="compass" title="Try something new" subtitle="Browse categories you haven’t done" onPress={() => nav.navigate('discover_search')} />}
        {help.host && <ListRow icon="plus-circle" title="Host a micro-plan" subtitle="Takes under a minute" onPress={() => nav.navigate('create_activity_type')} />}
        <ListRow icon="message-circle" title="Ask the IRL Guide" subtitle="Get ideas that fit your time" onPress={() => nav.navigate('plan_assistant')} />
        <ListRow icon="award" title="All achievements" onPress={() => nav.navigate('achievements')} last />
      </ListGroup>
    </Screen>
  );
}
