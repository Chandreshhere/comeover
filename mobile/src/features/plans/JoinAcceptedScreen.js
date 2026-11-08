// join_accepted — celebration + group access, venue revealed, safety share.
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, AvatarStack, Button, Card, Icon, ListGroup, ListRow, Mascot, Screen, ScreenHeader } from '@/components';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { durationLabel, timeLabel, whenLabel } from '@/utils/format';
import usePlan, { openGroupChat } from './usePlan';
import Confetti from './components/Confetti';
import PlanGate from './components/PlanGate';

export default function JoinAcceptedScreen() {
  const nav = useNavigation();
  const { id, activity: a, loader } = usePlan();
  const [opening, setOpening] = useState(false);

  if (!a) return <PlanGate title="Joined" loader={loader} />;

  const openChat = async () => {
    setOpening(true);
    try {
      await openGroupChat(nav, a);
    } finally {
      setOpening(false);
    }
  };

  return (
    <Screen
      bg={colors.periwinkle}
      header={<ScreenHeader variant="glass" onBack={() => nav.navigate('activity_detail', { id })} />}
      footer={<Button title="Open group chat" icon="message-circle" loading={opening} onPress={openChat} />}
    >
      <View style={{ alignItems: 'center' }}>
        <View style={{ alignItems: 'center', justifyContent: 'center', height: 220 }}>
          <Confetti burstKey={1} style={{ top: 100 }} />
          <Mascot size={200} mood="celebrate" celebrateKey={1} />
        </View>
        <AppText variant="display" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">
          You’re in!
        </AppText>
        <AppText color={colors.inkSoft} align="center" style={{ marginTop: 6, maxWidth: 300 }}>
          {a.joinRule === 'approval' ? `${a.host?.name || 'The host'} accepted you for ${a.title}.` : `You joined ${a.title}.`}
        </AppText>
        {(a.participants || []).length > 0 && (
          <View style={{ marginTop: space.md }}>
            <AvatarStack seeds={a.participants} size={38} max={5} ringColor={colors.periwinkle} />
          </View>
        )}
      </View>

      <Animated.View entering={enter(1)}>
        <Card style={{ marginTop: space.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="map-pin" size={18} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="caption" color={colors.muted}>
                {a.venueName ? 'Meeting spot (now visible to you)' : 'Meeting spot'}
              </AppText>
              <AppText variant="bodyStrong">{a.venueName || 'Shared in the group chat'}</AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                {[a.venueType, a.area].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md }}>
            <Icon name="clock" size={18} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="bodyStrong">{whenLabel(a.startsAt)}</AppText>
              <AppText variant="caption" color={colors.inkSoft}>
                {timeLabel(a.startsAt)} · {durationLabel(a.durationMin)}
              </AppText>
            </View>
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={enter(2)}>
        <ListGroup style={{ marginTop: space.md }}>
          <ListRow icon="share-2" title="Share with a trusted contact" subtitle="Send time, area and host to someone you trust" onPress={() => nav.navigate('emergency_share', { activityId: a.id })} />
          <ListRow icon="map-pin" title="Check in when you arrive" subtitle="Optional — opens 30 min before the start" onPress={() => nav.navigate('activity_checkin', { id })} />
          <ListRow icon="file-text" title="Plan details" onPress={() => nav.navigate('activity_detail', { id })} last />
        </ListGroup>
      </Animated.View>
    </Screen>
  );
}
