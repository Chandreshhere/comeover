// Gallery of error / permission / restricted states — doubles as a QA screen.
import React, { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, ErrorState, Screen, ScreenHeader, Skeleton, Tag } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import { timeLabel } from '@/utils/format';
import IconBubble from './IconBubble';

// Retry performs a real round-trip (GET /me/bootstrap) so QA can verify
// connectivity / service status from this screen.
function RetryableState({ kind, title, body, secondary, onSecondary, retryLabel, onRetry }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [result, setResult] = useState(null);
  const retry = async () => {
    if (onRetry) {
      onRetry();
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await useAppStore.getState().bootstrap();
      const st = useAppStore.getState().service?.status;
      setResult(st === 'maintenance' ? 'Server reachable. Maintenance is on.' : 'Server reachable. All good.');
    } catch (e) {
      setResult(e.code === 'network' || e.code === 'timeout' ? 'Still offline.' : e.message || 'Request failed.');
    } finally {
      setBusy(false);
      setLast(new Date());
    }
  };
  return (
    <View>
      {busy ? (
        <View style={{ alignItems: 'center', paddingVertical: space.xxl }}>
          <ActivityIndicator color={colors.ink} />
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            Retrying…
          </AppText>
        </View>
      ) : (
        <ErrorState kind={kind} title={title} body={body} onRetry={retry} retryLabel={retryLabel} secondary={secondary} onSecondary={onSecondary} />
      )}
      {last && !busy ? (
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginBottom: space.sm }} accessibilityLiveRegion="polite">
          {result} · {timeLabel(last)}
        </AppText>
      ) : null}
    </View>
  );
}

// Preview of the deletion-pending state. Deletion is cancelled by signing back
// in before the date (server-side), so this preview only links to Settings.
function DeletionPending({ onManage }) {
  const date = new Date(Date.now() + 30 * 864e5);
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.md }}>
      <IconBubble icon="user-x" tone="pink" size={72} iconSize={34} style={{ marginBottom: space.md }} />
      <AppText variant="h2" align="center">
        Deletion scheduled
      </AppText>
      <AppText color={colors.muted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
        Deletes on {date.getDate()}/{date.getMonth() + 1}/{date.getFullYear()}. Sign back in before then to cancel.
      </AppText>
      <Button title="Account settings" full={false} align="center" variant="secondary" style={{ marginTop: space.lg }} onPress={onManage} />
    </View>
  );
}

export default function ErrorStatesScreen() {
  const nav = useNavigation();

  const STATES = [
    { key: 'offline', tag: 'Offline', el: <RetryableState kind="offline" /> },
    {
      key: 'permission',
      tag: 'Permission denied',
      el: (
        <RetryableState
          kind="permission"
          retryLabel="Choose area manually"
          onRetry={() => nav.navigate('privacy_controls')}
          secondary="Open phone settings"
          onSecondary={() => Linking.openSettings().catch(() => {})}
        />
      ),
    },
    { key: 'api', tag: 'API failure', el: <RetryableState kind="api" /> },
    {
      key: 'restricted',
      tag: 'Restricted account',
      el: <RetryableState kind="restricted" retryLabel="Check status" secondary="Appeal or get help" onSecondary={() => nav.navigate('safety_center')} />,
    },
    { key: 'maintenance', tag: 'Maintenance', el: <RetryableState kind="maintenance" secondary="Service status" onSecondary={() => nav.navigate('service_status')} /> },
    {
      key: 'deletion',
      tag: 'Deletion pending',
      el: <DeletionPending onManage={() => nav.navigate('account_settings')} />,
    },
  ];

  return (
    <Screen header={<ScreenHeader title="Error states" subtitle="QA gallery" />}>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
        Each state says what happened and how to recover.
      </AppText>

      <Card style={{ marginTop: space.md }}>
        <Tag label="Loading skeleton" bg={colors.periwinkleWash} fg={colors.ink} />
        <View style={{ flexDirection: 'row', marginTop: space.md }}>
          <Skeleton width={56} height={56} r={18} />
          <View style={{ flex: 1, marginLeft: space.sm, justifyContent: 'center' }}>
            <Skeleton width="70%" height={12} />
            <Skeleton width="45%" height={10} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Card>

      <View style={{ gap: space.md, marginTop: space.md }}>
        {STATES.map((s) => (
          <Card key={s.key} padding={space.sm}>
            <Tag label={s.tag} bg={colors.periwinkleWash} fg={colors.ink} style={{ margin: space.xs }} />
            {s.el}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
