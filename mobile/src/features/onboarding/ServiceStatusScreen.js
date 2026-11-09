// service_status — maintenance / service unavailable. Emergency guidance stays reachable.
import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Siren } from 'phosphor-react-native/src/icons/Siren';
import { AppText, ErrorState, Icon, Screen } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import config from '@/config';
import { colors, radius, space } from '@/theme/tokens';
import IconBubble from '@/features/system/IconBubble';

export default function ServiceStatusScreen() {
  const nav = useNavigation();
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);

  // Re-runs session restore + GET /me/bootstrap, which reports service status.
  const retry = async () => {
    setChecking(true);
    try {
      await useAppStore.getState().initSession();
    } catch (e) {
      // status stays as reported; fall through to the check below
    } finally {
      setChecking(false);
    }
    if (useAppStore.getState().service?.status === 'maintenance') setStillDown(true);
    else nav.replace('boot_splash');
  };

  const callEmergency = () => Linking.openURL(`tel:${config.EMERGENCY_NUMBER_IN}`).catch(() => {});

  return (
    <Screen bg={colors.canvas} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <ErrorState
        kind="maintenance"
        body={stillDown ? 'Still tuning things up. Your plans and chats are safe.' : 'Scheduled maintenance. Your plans and chats are safe.'}
        onRetry={checking ? undefined : retry}
        retryLabel="Check again"
      />
      {checking && (
        <AppText variant="caption" color={colors.muted} align="center" accessibilityLiveRegion="polite">
          Checking…
        </AppText>
      )}
      {/* Emergency help never depends on the app: one tappable row, not a
          second filled button competing with "Check again". */}
      <Pressable
        onPress={callEmergency}
        accessibilityRole="button"
        accessibilityLabel={`Feel unsafe at a meetup? Call emergency services on ${config.EMERGENCY_NUMBER_IN}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 64,
          marginTop: space.xl,
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <IconBubble icon={Siren} tone="danger" size={44} iconSize={22} />
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <AppText variant="bodyStrong">Feel unsafe at a meetup?</AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            You don't need the app to get help.
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="phone" size={16} color={colors.danger} />
          <AppText variant="bodyStrong" color={colors.danger} style={{ marginLeft: space.xxs }}>
            {config.EMERGENCY_NUMBER_IN}
          </AppText>
        </View>
      </Pressable>
    </Screen>
  );
}
