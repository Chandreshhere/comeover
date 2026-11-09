// privacy_controls — who can find you, location and your data (DPDP: plain
// language, consent can be withdrawn here). Notification choices live in Settings.
import React, { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, ChipGrid, Icon, ListGroup, ListRow, OptionCard, Screen, ScreenHeader, SectionHeader, Segmented, Sheet } from '@/components';
import { CITY } from '@/data/catalog';
import config from '@/config';
import api from '@/api/client';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';

const VISIBILITY = [
  { value: 'discoverable', title: 'Discoverable', subtitle: 'People nearby can see your profile' },
  { value: 'friends_only', title: 'Circles only', subtitle: 'Only people in your circles' },
  { value: 'hidden', title: 'Hidden', subtitle: 'Hosts see you only when you ask to join' },
];

const RETENTION = [
  ['Exact device location', 'Never stored. Only your neighbourhood is used.'],
  ['Plan & group messages', 'Deleted 12 months after the plan ends.'],
  ['Reports & safety records', 'Kept as long as safety or the law requires.'],
  ['Account data', 'Deleted within 30 days of a deletion request.'],
  ['Analytics', 'Only with your consent. Never sold.'],
];

export default function PrivacyControlsScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const prefs = useAppStore((s) => s.prefs);
  const setProfile = useAppStore((s) => s.setProfile);
  const setPrefs = useAppStore((s) => s.setPrefs);

  const [exportState, setExportState] = useState('idle'); // idle | sending | requested | emailed | error
  const [exportError, setExportError] = useState(null);
  const [retentionOpen, setRetentionOpen] = useState(false);

  // DPDP data-access request. POST /me/data-export; if the backend doesn't
  // expose it yet (404), fall back to emailing the grievance officer.
  const requestExport = async () => {
    setExportState('sending');
    setExportError(null);
    try {
      await api.post('/me/data-export', { channel: 'sms_link' }, { idempotencyKey: `data-export:${new Date().toISOString().slice(0, 10)}` });
      setExportState('requested');
    } catch (e) {
      if (e.status === 404 || e.status === 405) {
        const subject = encodeURIComponent('Data access request (Come Over)');
        const body = encodeURIComponent('Please send me a copy of the personal data Come Over holds about me. My account is linked to my verified phone number.');
        try {
          await Linking.openURL(`mailto:${config.SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
          setExportState('emailed');
        } catch (err) {
          setExportState('error');
          setExportError(`Email ${config.SUPPORT_EMAIL} to request a copy.`);
        }
      } else {
        setExportState('error');
        setExportError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Try again when connected." : e.message || "Couldn't send the request. Try again.");
      }
    }
  };
  const exportDone = exportState === 'requested' || exportState === 'emailed';
  const exportLine =
    exportState === 'requested'
      ? "We'll text you a secure link within 7 days"
      : exportState === 'emailed'
      ? 'Send the email that opened to finish'
      : exportState === 'error'
      ? exportError
      : 'Profile, plans, messages and reports';

  const usingDevice = prefs.location === 'granted';
  const radiusOptions = config.RADIUS_OPTIONS_KM.map((km) => ({ value: km, label: `${km} km` }));

  return (
    <Screen header={<ScreenHeader title="Privacy" />}>
      {/* Who can find you */}
      <SectionHeader title="Who can find you" style={{ marginTop: space.sm }} />
      {VISIBILITY.map((v) => (
        <OptionCard key={v.value} title={v.title} subtitle={v.subtitle} selected={profile.visibility === v.value} onPress={() => setProfile({ visibility: v.value })} />
      ))}
      <ListGroup style={{ marginTop: space.xs }}>
        <ListRow icon="radio" title="Show me on Live" subtitle="An “available now” card, never a map dot" toggle={prefs.showOnRadar} onToggle={(v) => setPrefs({ showOnRadar: v })} last />
      </ListGroup>

      {/* Location */}
      <SectionHeader title="Location" />
      <OptionCard
        title="Approximate location"
        subtitle={usingDevice ? 'On, only while the app is open' : 'Finds plans near you'}
        selected={usingDevice}
        left={<Icon name="navigation" size={20} color={usingDevice ? colors.white : colors.ink} />}
        onPress={() => (usingDevice ? null : nav.navigate('location_explainer'))}
      />
      <OptionCard
        title="Pick my area"
        subtitle="No GPS at all"
        selected={!usingDevice}
        left={<Icon name="map" size={20} color={!usingDevice ? colors.white : colors.ink} />}
        onPress={() => setPrefs({ location: 'manual', coords: null })}
      />
      {!usingDevice && (
        <ChipGrid columns={2} style={{ marginTop: space.xxs }}>
          {CITY.areas.map((a) => (
            <Chip key={a} label={a} fill selected={profile.area === a} onPress={() => setProfile({ area: a })} />
          ))}
        </ChipGrid>
      )}
      <AppText variant="label" color={colors.inkSoft} style={{ marginTop: space.lg, marginBottom: space.xs }}>
        Discovery radius
      </AppText>
      <Segmented options={radiusOptions} value={prefs.radiusKm} onChange={(km) => setPrefs({ radiusKm: km })} />
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Others only see your area and a rough distance.
      </AppText>

      {/* Your data */}
      <SectionHeader title="Your data" />
      <ListGroup>
        <ListRow icon="bar-chart-2" title="Usage analytics" subtitle="Anonymous. Off by default." toggle={prefs.analyticsConsent} onToggle={(v) => setPrefs({ analyticsConsent: v })} />
        <ListRow icon="clock" title="How long we keep data" onPress={() => setRetentionOpen(true)} />
        <ListRow
          icon="download"
          title={exportDone ? 'Copy requested' : 'Download my data'}
          subtitle={exportLine}
          onPress={exportDone || exportState === 'sending' ? undefined : requestExport}
          right={exportState === 'sending' ? <ActivityIndicator color={colors.ink} /> : exportDone ? <Icon name="check" color={colors.success} /> : undefined}
        />
        <ListRow icon="trash-2" title="Delete my account" danger onPress={() => nav.navigate('account_settings', { focus: 'delete' })} last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        Withdraw any consent here, anytime. Questions: {config.SUPPORT_EMAIL}
      </AppText>

      <Sheet visible={retentionOpen} onClose={() => setRetentionOpen(false)} title="How long we keep data" footer={<Button title="Got it" onPress={() => setRetentionOpen(false)} />}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
          {RETENTION.map(([k, v], i) => (
            <View key={k} style={{ paddingVertical: space.sm, borderBottomWidth: i === RETENTION.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <AppText variant="bodyStrong">{k}</AppText>
              <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                {v}
              </AppText>
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
