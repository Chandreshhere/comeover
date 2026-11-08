// Location, discoverability, visibility, notifications and data controls.
// Plain-language notices per the DPDP direction in the blueprint.
import React, { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Button,
  Card,
  Chip,
  Icon,
  ListGroup,
  ListRow,
  OptionCard,
  Screen,
  ScreenHeader,
  SectionHeader,
  Segmented,
  Sheet,
} from '@/components';
import { CITY } from '@/data/catalog';
import config from '@/config';
import api from '@/api/client';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';

const VISIBILITY = [
  { value: 'discoverable', title: 'Discoverable', subtitle: 'People nearby can see your profile card on plans and in Live.' },
  { value: 'friends_only', title: 'Circles only', subtitle: 'Only members of circles you have joined can see your profile.' },
  { value: 'hidden', title: 'Hidden', subtitle: "You can still join plans; hosts see your card only when you request." },
];

const RETENTION = [
  ['Exact device location', 'Never stored on our servers. Only your neighbourhood is used for matching.'],
  ['Plan & group messages', 'Kept while the plan is active and deleted 12 months after it ends.'],
  ['Reports & safety records', 'Kept as long as needed to keep the community safe or as required by law.'],
  ['Account data', 'Deleted within 30 days of an account deletion request.'],
  ['Analytics', 'Only collected if you opt in, and never sold.'],
];

const QUIET_START = ['21:00', '22:00', '23:00'];
const QUIET_END = ['07:00', '08:00', '09:00'];

export default function PrivacyControlsScreen() {
  const nav = useNavigation();
  const profile = useAppStore((s) => s.profile);
  const prefs = useAppStore((s) => s.prefs);
  const setProfile = useAppStore((s) => s.setProfile);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const setNotificationPrefs = useAppStore((s) => s.setNotificationPrefs);

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
        const subject = encodeURIComponent('Data access request (Project IRL)');
        const body = encodeURIComponent('Please send me a copy of the personal data Project IRL holds about me. My account is linked to my verified phone number.');
        try {
          await Linking.openURL(`mailto:${config.SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
          setExportState('emailed');
        } catch (err) {
          setExportState('error');
          setExportError(`Email ${config.SUPPORT_EMAIL} to request a copy of your data.`);
        }
      } else {
        setExportState('error');
        setExportError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Try again when connected." : e.message || "Couldn't send the request. Try again.");
      }
    }
  };
  const exportDone = exportState === 'requested' || exportState === 'emailed';

  const n = prefs.notifications;
  const quietOn = n.quietEnabled !== false;
  const usingDevice = prefs.location === 'granted';

  return (
    <Screen header={<ScreenHeader title="Privacy" subtitle="You're in control" />}>
      {/* Discoverability */}
      <SectionHeader title="Who can find you" style={{ marginTop: space.sm }} />
      {VISIBILITY.map((v) => (
        <OptionCard key={v.value} title={v.title} subtitle={v.subtitle} selected={profile.visibility === v.value} onPress={() => setProfile({ visibility: v.value })} />
      ))}
      <ListGroup style={{ marginTop: space.xs }}>
        <ListRow
          icon="radio"
          title="Show me on Live"
          subtitle="Shares an 'available now' intent card for your area — never a map dot."
          toggle={prefs.showOnRadar}
          onToggle={(v) => setPrefs({ showOnRadar: v })}
          last
        />
      </ListGroup>

      {/* Location */}
      <SectionHeader title="Location" />
      <OptionCard
        title="Approximate device location"
        subtitle={usingDevice ? 'On — used only while the app is open' : 'Finds plans near you automatically'}
        selected={usingDevice}
        left={<Icon name="navigation" size={20} color={usingDevice ? colors.white : colors.ink} />}
        onPress={() => (usingDevice ? null : nav.navigate('location_explainer'))}
      />
      <OptionCard
        title="Choose my area manually"
        subtitle="No GPS at all — pick a neighbourhood"
        selected={!usingDevice}
        left={<Icon name="map" size={20} color={!usingDevice ? colors.white : colors.ink} />}
        onPress={() => setPrefs({ location: 'manual', coords: null })}
      />
      {!usingDevice && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
          {CITY.areas.map((a) => (
            <Chip key={a} label={a} selected={profile.area === a} onPress={() => setProfile({ area: a })} />
          ))}
        </View>
      )}
      <Card elevated={false} bg={colors.periwinkleWash} padding={12} style={{ marginTop: space.sm, flexDirection: 'row' }}>
        <Icon name="eye-off" size={16} color={colors.deep} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          Other people only ever see a coarse distance and neighbourhood. Exact meeting spots are shared inside a plan's group after you're accepted. No background tracking.
        </AppText>
      </Card>

      <AppText variant="label" style={{ marginTop: space.lg, marginBottom: space.xs }}>
        Discovery radius
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {config.RADIUS_OPTIONS_KM.map((km) => (
          <Chip key={km} label={`${km} km`} selected={prefs.radiusKm === km} onPress={() => setPrefs({ radiusKm: km })} />
        ))}
      </View>

      {/* Notifications */}
      <SectionHeader title="Notifications" />
      <ListGroup>
        <ListRow icon="user-check" title="Join requests & approvals" toggle={n.joinRequests} onToggle={(v) => setNotificationPrefs({ joinRequests: v })} />
        <ListRow icon="message-circle" title="Group messages" toggle={n.messages} onToggle={(v) => setNotificationPrefs({ messages: v })} />
        <ListRow icon="map-pin" title="Plans starting nearby" subtitle="Max 2 a day" toggle={n.nearby} onToggle={(v) => setNotificationPrefs({ nearby: v })} />
        <ListRow icon="award" title="Quest reminders" toggle={n.questReminders} onToggle={(v) => setNotificationPrefs({ questReminders: v })} />
        <ListRow icon="mail" title="Product news & offers" subtitle="Off unless you opt in" toggle={n.productUpdates} onToggle={(v) => setNotificationPrefs({ productUpdates: v })} />
        <ListRow icon="moon" title="Quiet hours" subtitle="Safety alerts still come through" toggle={quietOn} onToggle={(v) => setNotificationPrefs({ quietEnabled: v })} last />
      </ListGroup>
      {quietOn && (
        <View style={{ marginTop: space.sm }}>
          <AppText variant="caption" color={colors.muted} style={{ marginBottom: 6 }}>
            Quiet from
          </AppText>
          <Segmented compact options={QUIET_START} value={n.quietStart} onChange={(v) => setNotificationPrefs({ quietStart: v })} />
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm, marginBottom: 6 }}>
            Until
          </AppText>
          <Segmented compact options={QUIET_END} value={n.quietEnd} onChange={(v) => setNotificationPrefs({ quietEnd: v })} />
        </View>
      )}

      {/* Data */}
      <SectionHeader title="Your data" />
      <ListGroup>
        <ListRow
          icon="bar-chart-2"
          title="Help improve the app"
          subtitle="Anonymous usage analytics. Off by default."
          toggle={prefs.analyticsConsent}
          onToggle={(v) => setPrefs({ analyticsConsent: v })}
        />
        <ListRow icon="clock" title="How long we keep data" onPress={() => setRetentionOpen(true)} />
        <ListRow
          icon="download"
          title={exportDone ? 'Copy requested' : 'Download my data'}
          subtitle={
            exportState === 'requested'
              ? "We'll send a secure link to your verified phone within 7 days."
              : exportState === 'emailed'
              ? 'Your email app opened with the request — send it to finish.'
              : exportState === 'error'
              ? exportError
              : 'Profile, plans, messages and reports you filed'
          }
          onPress={exportDone || exportState === 'sending' ? undefined : requestExport}
          right={exportState === 'sending' ? <ActivityIndicator color={colors.ink} /> : exportDone ? <Icon name="check" color={colors.success} /> : undefined}
        />
        <ListRow icon="trash-2" title="Delete my account" danger onPress={() => nav.navigate('account_settings', { focus: 'delete' })} last />
      </ListGroup>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
        You can withdraw any consent here at any time. Questions about your data: {config.SUPPORT_EMAIL}
      </AppText>

      <Sheet visible={retentionOpen} onClose={() => setRetentionOpen(false)} title="How long we keep data">
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md }}>
          {RETENTION.map(([k, v], i) => (
            <View key={k} style={{ paddingVertical: space.xs, borderBottomWidth: i === RETENTION.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <AppText variant="bodyStrong">{k}</AppText>
              <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                {v}
              </AppText>
            </View>
          ))}
        </View>
        <Button title="Got it" style={{ marginTop: space.md }} onPress={() => setRetentionOpen(false)} />
      </Sheet>
    </Screen>
  );
}
