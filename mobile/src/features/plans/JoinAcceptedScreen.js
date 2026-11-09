// join_accepted — celebration, the now-revealed meeting spot, and the chat.
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { CalendarCheck } from 'phosphor-react-native/src/icons/CalendarCheck';
import { AppText, Button, ListGroup, ListRow, Mascot, Screen, ScreenHeader } from '@/components';
import { IconBubble } from '@/components/Card';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { durationLabel, timeLabel, whenLabel } from '@/utils/format';
import usePlan, { openGroupChat } from './usePlan';
import Confetti from './components/Confetti';
import PlanGate from './components/PlanGate';

// Fact row inside the meeting card: squircle + title/subtitle, min 64 tall.
function Fact({ icon, glyph, label, title, sub, last }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }} accessible accessibilityLabel={[label, title, sub].filter(Boolean).join('. ')}>
      <IconBubble size={40} shape="squircle" tone="periwinkle" icon={icon} glyph={glyph} iconSize={22} />
      <View style={{ flex: 1, marginLeft: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {!!sub && (
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {sub}
          </AppText>
        )}
      </View>
    </View>
  );
}

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
        <View style={{ alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', height: 180 }}>
          <Confetti burstKey={1} style={{ top: 90 }} />
          <Mascot size={170} mood="celebrate" celebrateKey={1} />
        </View>
        <AppText variant="display" align="center" style={{ marginTop: space.xs }} accessibilityRole="header" accessibilityLiveRegion="polite">
          You’re in!
        </AppText>
        <AppText color={colors.inkSoft} align="center" numberOfLines={2} style={{ marginTop: space.xxs, maxWidth: 300 }}>
          {a.joinRule === 'approval' ? `${a.host?.name || 'The host'} accepted you for ${a.title}.` : `You joined ${a.title}.`}
        </AppText>
      </View>

      <Animated.View entering={enter(1)}>
        <ListGroup style={{ marginTop: space.xl }}>
          <Fact
            icon="map-pin"
            label="Meeting spot"
            title={a.venueName || 'Shared in the group chat'}
            sub={[a.venueType, a.area].filter(Boolean).join(' · ') || null}
          />
          <Fact glyph={CalendarCheck} label="When" title={whenLabel(a.startsAt)} sub={`${timeLabel(a.startsAt)} · ${durationLabel(a.durationMin)}`} last />
        </ListGroup>
      </Animated.View>

      <Animated.View entering={enter(2)}>
        <ListGroup style={{ marginTop: space.md }}>
          <ListRow icon="share-2" title="Share with a trusted contact" onPress={() => nav.navigate('emergency_share', { activityId: a.id })} />
          <ListRow icon="gps" title="Check in when you arrive" subtitle="Opens 30 min before the start" onPress={() => nav.navigate('activity_checkin', { id })} />
          <ListRow icon="file-text" title="Plan details" onPress={() => nav.navigate('activity_detail', { id })} last />
        </ListGroup>
      </Animated.View>
    </Screen>
  );
}
