// welcome — brand promise and CTA. Periwinkle hero in the roadmap screen's language.
import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, Mascot, PictogramCluster, Screen } from '@/components';
import { colors, layout, radius, space, type } from '@/theme/tokens';
import { enter } from '@/theme/motion';

const POINTS = [
  { icon: 'users', text: 'Platonic & activity-first — not a dating app' },
  { icon: 'map-pin', text: 'Small plans at public places near you' },
  { icon: 'shield', text: 'Hosts approve who joins. Chat opens after.' },
];

export default function WelcomeScreen() {
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const heroW = width - layout.screenPadding * 2;

  return (
    <Screen
      bg={colors.periwinkle}
      footer={
        <View>
          <Button title="Get started" iconRight="arrow-right" onPress={() => nav.navigate('phone_entry')} />
          <Button title="I already have an account" variant="ghost" style={{ marginTop: space.xs }} onPress={() => nav.navigate('phone_entry', { mode: 'login' })} />
        </View>
      }
    >
      <View style={{ height: 270, marginTop: space.lg, alignItems: 'center' }}>
        <View style={{ position: 'absolute', top: 0 }}>
          <PictogramCluster width={heroW} height={150} />
        </View>
        <Mascot size={Math.min(240, heroW * 0.7)} style={{ position: 'absolute', bottom: 0 }} />
      </View>

      <Animated.View entering={enter(1)}>
        <AppText variant="display" align="center" style={{ marginTop: space.lg, fontSize: 34, lineHeight: 40 }} accessibilityRole="header">
          Less scrolling.{'\n'}More living.
        </AppText>
        <AppText variant="body" align="center" color={colors.inkSoft} style={{ marginTop: space.xs, fontFamily: type.h3.fontFamily }}>
          Find someone for whatever you're doing — chai, badminton, a sunset walk.
        </AppText>
      </Animated.View>

      <View style={{ marginTop: space.lg, gap: space.xs }}>
        {POINTS.map((p, i) => (
          <Animated.View
            key={p.text}
            entering={enter(2 + i)}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.38)', borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 14 }}
          >
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={p.icon} size={15} color={colors.white} />
            </View>
            <AppText variant="label" style={{ marginLeft: space.sm, flex: 1 }}>
              {p.text}
            </AppText>
          </Animated.View>
        ))}
      </View>
    </Screen>
  );
}
