// Gallery of empty states (QA + design reference). Every state offers a way forward.
import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Card, EmptyState, Screen, ScreenHeader, Tag } from '@/components';
import { colors, space } from '@/theme/tokens';

export default function EmptyStatesScreen() {
  const nav = useNavigation();
  const tab = (screen) => nav.navigate('main', { screen });

  const STATES = [
    {
      key: 'activity',
      tag: 'Discover',
      title: 'Nothing nearby yet',
      body: 'No plans in your radius right now. Start one?',
      cta: 'Create a plan',
      onCta: () => nav.navigate('create_activity_type'),
      secondary: 'Widen my radius',
      onSecondary: () => nav.navigate('filters_sheet'),
      pose: 'stride',
    },
    {
      key: 'chats',
      tag: 'Inbox',
      title: 'No chats yet',
      body: 'Group chats open once a host accepts you into a plan.',
      cta: 'Find a plan',
      onCta: () => tab('discover_home'),
      pose: 'wave',
    },
    {
      key: 'circles',
      tag: 'Circles',
      title: 'No circles yet',
      body: 'Circles are groups that meet again and again.',
      cta: 'Explore circles',
      onCta: () => tab('circles_home'),
      secondary: 'Start a circle',
      onSecondary: () => nav.navigate('circle_create'),
      pose: 'cheer',
    },
    {
      key: 'quests',
      tag: 'Progress',
      title: 'No quests right now',
      body: "New quests unlock after your next meetup. Rest days never break your streak.",
      cta: 'See my roadmap',
      onCta: () => nav.navigate('social_roadmap'),
      pose: 'wave',
    },
    {
      key: 'search',
      tag: 'Search',
      title: 'No matches',
      body: 'Try another activity or a wider time window.',
      cta: 'Ask the guide',
      onCta: () => nav.navigate('plan_assistant'),
      pose: 'stride',
    },
    {
      key: 'notifications',
      tag: 'System',
      title: "You're all caught up",
      body: 'Join requests and plan updates will show up here.',
      cta: 'Back to Discover',
      onCta: () => tab('discover_home'),
      pose: 'cheer',
    },
  ];

  return (
    <Screen header={<ScreenHeader title="Empty states" subtitle={`${STATES.length} variants`} />}>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        Every empty state offers a next step.
      </AppText>
      <View style={{ gap: space.md, marginTop: space.md }}>
        {STATES.map((s) => (
          <Card key={s.key} padding={space.sm}>
            <Tag label={s.tag} bg={colors.periwinkleWash} fg={colors.ink} style={{ margin: space.xs }} />
            <EmptyState compact title={s.title} body={s.body} cta={s.cta} onCta={s.onCta} secondary={s.secondary} onSecondary={s.onSecondary} pose={s.pose} />
          </Card>
        ))}
      </View>
    </Screen>
  );
}
