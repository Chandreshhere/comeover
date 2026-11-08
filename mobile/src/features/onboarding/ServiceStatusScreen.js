// service_status — maintenance / service unavailable. Emergency guidance stays reachable.
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, ErrorState, Icon, Screen } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import config from '@/config';
import { colors, radius, space } from '@/theme/tokens';

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

  return (
    <Screen bg={colors.canvas} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <ErrorState
        kind="maintenance"
        body={stillDown ? "Still tuning things up. We'll be back shortly — your plans and chats are safe." : "We're doing scheduled maintenance. Your plans and chats are safe."}
        onRetry={checking ? undefined : retry}
        retryLabel="Check again"
      />
      {checking && (
        <AppText variant="caption" color={colors.muted} align="center">
          Checking…
        </AppText>
      )}
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.pinkSoft, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}>
          <Icon name="alert-triangle" size={18} color={colors.danger} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">At a meetup and feel unsafe?</AppText>
          <AppText variant="caption" color={colors.muted}>
            Call emergency services on {config.EMERGENCY_NUMBER_IN}. You don't need the app for that.
          </AppText>
        </View>
      </View>
      <Button
        title={`Call ${config.EMERGENCY_NUMBER_IN}`}
        variant="danger"
        icon="phone"
        style={{ marginTop: space.sm }}
        onPress={() => Linking.openURL(`tel:${config.EMERGENCY_NUMBER_IN}`)}
      />
    </Screen>
  );
}
