// account_settings — one calm list: Account, Appearance & sound, Notifications,
// Privacy & safety, Help, then log out / delete. Details live in sheets.
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { RESULTS, requestNotifications } from 'react-native-permissions';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  AppText,
  Avatar,
  Button,
  Icon,
  ListGroup,
  ListRow,
  OptionCard,
  QueryState,
  Screen,
  ScreenHeader,
  SectionHeader,
  Segmented,
  Sheet,
  Tag,
} from '@/components';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { STYLE_META } from '@/utils/socialMatch';
import pkg from '../../../package.json';
import { goTab, maskPhone, resetTo } from './navHelpers';

const LANGUAGES = ['English', 'हिन्दी (Hindi)', 'ગુજરાતી (Gujarati)'];
const TIER_LABEL = { free: 'Free', plus: 'Plus', pro: 'Pro', venue: 'Venue / Club' };
const APPEARANCE = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const QUIET_START = ['21:00', '22:00', '23:00'];
const QUIET_END = ['07:00', '08:00', '09:00'];

// What happens on deletion: one short line each (shown in the confirm sheet).
const DELETE_FACTS = [
  ['clock', 'Deleted after 30 days. Log in before then to cancel.'],
  ['eye-off', 'Your profile is hidden now and hosted plans are cancelled.'],
  ['shield', 'Safety records we must keep by law are kept, then deleted.'],
  ['credit-card', 'Cancel store subscriptions in your App Store / Play account.'],
];

const errText = (e, fallback) => (e?.code === 'network' || e?.code === 'timeout' ? "You're offline. Try again when connected." : e?.message || fallback);

export default function AccountSettingsScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const session = useAppStore((s) => s.session);
  const prefs = useAppStore((s) => s.prefs);
  const blocked = useAppStore((s) => s.blocked);
  const users = useAppStore((s) => s.users);
  const tier = useAppStore((s) => s.subscription.tier) || 'free';
  const socialStyle = useAppStore((s) => s.profile.socialStyle);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const setNotificationPrefs = useAppStore((s) => s.setNotificationPrefs);
  const enablePush = useAppStore((s) => s.enablePush);
  const unblockUser = useAppStore((s) => s.unblockUser);
  const logout = useAppStore((s) => s.logout);
  const deleteAccount = useAppStore((s) => s.deleteAccount);

  // GET /me/blocks (+ reports, trusted contacts) and GET /me/subscription.
  const safetyQ = useLoader('safety', (s) => s.loadSafety());
  const subQ = useLoader('subscription', (s) => s.loadSubscription());

  const [sheet, setSheet] = useState(null); // language | quiet | blocked | logout | delete
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);
  const [unblocking, setUnblocking] = useState(null); // userId in flight
  const [unblockError, setUnblockError] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState(null);

  useEffect(() => {
    if (route.params?.focus === 'delete') setSheet('delete');
  }, [route.params?.focus]);

  const appearance = prefs.appearance || 'system';
  const styleMeta = socialStyle ? STYLE_META[socialStyle] : null;
  const n = prefs.notifications;
  const quietOn = n.quietEnabled !== false;
  const close = () => setSheet(null);

  const replayTour = () => {
    setPrefs({ tourDone: false });
    goTab(nav, 'discover_home');
  };

  const blockedPeople = useMemo(() => blocked.map((id) => users[id] || { id, name: 'Blocked member' }), [blocked, users]);

  // Ask the OS, then register this device (POST /devices). If the OS already
  // said no, the only way back is the system Settings app.
  const turnOnPush = async () => {
    setPushBusy(true);
    setPushNote(null);
    try {
      const { status } = await requestNotifications(['alert', 'sound', 'badge']);
      const ok = status === RESULTS.GRANTED || status === RESULTS.LIMITED;
      setNotificationPrefs({ enabled: ok });
      if (!ok) {
        Linking.openSettings().catch(() => setPushNote('Turn notifications on in your phone settings.'));
        return;
      }
      const r = await enablePush().catch((e) => ({ enabled: false, reason: e?.code === 'network' || e?.code === 'timeout' ? 'offline' : 'error' }));
      if (!r?.enabled) setPushNote(r?.reason === 'offline' ? "You're offline. Try again when connected." : "Couldn't register this phone. Try again later.");
    } catch (e) {
      setPushNote("Couldn't turn on notifications. Try again.");
    } finally {
      setPushBusy(false);
    }
  };

  const doLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout(); // GlobalSignOut + push token removal + Keychain wipe
      setSheet(null);
      resetTo(nav, 'boot_splash');
    } catch (e) {
      setLogoutError("Couldn't finish logging out. Try again.");
    } finally {
      setLoggingOut(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      setSheet(null);
      resetTo(nav, 'boot_splash');
    } catch (e) {
      setDeleteError(errText(e, "Couldn't start deletion. Try again."));
    } finally {
      setDeleting(false);
    }
  };

  const doUnblock = async (id) => {
    setUnblocking(id);
    setUnblockError(null);
    try {
      await unblockUser(id);
    } catch (e) {
      setUnblockError(errText(e, "Couldn't unblock. Try again."));
    } finally {
      setUnblocking(null);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Settings" />}>
      {/* Account */}
      <SectionHeader title="Account" style={{ marginTop: space.sm }} />
      <ListGroup>
        <ListRow
          icon="smartphone"
          title="Phone number"
          subtitle={maskPhone(session.phone)}
          right={session.verified ? <Tag label="Verified" icon="check" bg={colors.mint} fg={colors.ink} style={{ alignSelf: 'center' }} /> : null}
        />
        <ListRow icon="smiley" title="Social style" value={styleMeta ? styleMeta.label : 'Not set'} onPress={() => nav.navigate('social_style', { mode: 'edit' })} />
        <ListRow icon="globe" title="Language" value={prefs.language} onPress={() => setSheet('language')} />
        <ListRow
          icon="star"
          title="Subscription"
          value={subQ.status === 'loading' && !tier ? '…' : TIER_LABEL[tier] || tier}
          subtitle={subQ.status === 'error' ? "Couldn't refresh" : undefined}
          onPress={() => nav.navigate('subscription_manage')}
          last
        />
      </ListGroup>

      {/* Appearance & sound */}
      <SectionHeader title="Appearance & sound" />
      <Segmented options={APPEARANCE} value={appearance} onChange={(v) => setPrefs({ appearance: v })} />
      <ListGroup style={{ marginTop: space.sm }}>
        <ListRow icon="zap" title="Haptics" toggle={prefs.haptics} onToggle={(v) => setPrefs({ haptics: v })} />
        <ListRow icon="volume-2" title="Sounds" toggle={prefs.sound} onToggle={(v) => setPrefs({ sound: v })} />
        <ListRow icon="mic" title="Guide voice" subtitle="Reads tips out loud" toggle={prefs.guideVoice !== false} onToggle={(v) => setPrefs({ guideVoice: v })} last />
      </ListGroup>

      {/* Notifications */}
      <SectionHeader title="Notifications" />
      <ListGroup>
        <ListRow
          icon={n.enabled ? 'bell' : 'bell-off'}
          title="Push notifications"
          subtitle={pushNote || undefined}
          value={pushBusy ? '…' : n.enabled ? 'On' : 'Off'}
          onPress={pushBusy ? undefined : n.enabled ? () => Linking.openSettings().catch(() => {}) : turnOnPush}
        />
        <ListRow icon="user-check" title="Join requests" toggle={n.joinRequests} onToggle={(v) => setNotificationPrefs({ joinRequests: v })} />
        <ListRow icon="message-circle" title="Group messages" toggle={n.messages} onToggle={(v) => setNotificationPrefs({ messages: v })} />
        <ListRow icon="map-pin" title="Plans nearby" subtitle="Max 2 a day" toggle={n.nearby} onToggle={(v) => setNotificationPrefs({ nearby: v })} />
        <ListRow icon="award" title="Quest reminders" toggle={n.questReminders} onToggle={(v) => setNotificationPrefs({ questReminders: v })} />
        <ListRow icon="mail" title="News & offers" toggle={n.productUpdates} onToggle={(v) => setNotificationPrefs({ productUpdates: v })} />
        <ListRow icon="moon" title="Quiet hours" value={quietOn ? `${n.quietStart}–${n.quietEnd}` : 'Off'} onPress={() => setSheet('quiet')} last />
      </ListGroup>

      {/* Privacy & safety */}
      <SectionHeader title="Privacy & safety" />
      <ListGroup>
        <ListRow icon="lock" title="Privacy" onPress={() => nav.navigate('privacy_controls')} />
        <ListRow icon="shield" title="Safety center" onPress={() => nav.navigate('safety_center')} />
        <ListRow
          icon="slash"
          title="Blocked people"
          value={safetyQ.status === 'loading' && !blocked.length ? '…' : String(blocked.length)}
          onPress={() => setSheet('blocked')}
          last
        />
      </ListGroup>

      {/* Help */}
      <SectionHeader title="Help" />
      <ListGroup>
        <ListRow icon="map-trifold" title="Replay app tour" onPress={replayTour} />
        <ListRow icon="book-open" title="Community guidelines" onPress={() => nav.navigate('safety_center', { section: 'guidelines' })} />
        <ListRow
          icon="mail"
          title="Support & grievances"
          subtitle={config.SUPPORT_EMAIL}
          onPress={() => Linking.openURL(`mailto:${config.SUPPORT_EMAIL}?subject=Come%20Over%20support`).catch(() => {})}
          last
        />
      </ListGroup>

      <ListGroup style={{ marginTop: space.xl }}>
        <ListRow icon="log-out" title="Log out" onPress={() => setSheet('logout')} />
        <ListRow icon="trash-2" title="Delete account" danger onPress={() => setSheet('delete')} last />
      </ListGroup>

      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.lg }}>
        Come Over {pkg.version}
      </AppText>

      {/* Language */}
      <Sheet visible={sheet === 'language'} onClose={close} title="Language">
        {LANGUAGES.map((l) => {
          const v = l.split(' ')[0] === 'English' ? 'English' : l;
          return (
            <OptionCard
              key={l}
              title={l}
              selected={prefs.language === v}
              onPress={() => {
                setPrefs({ language: v });
                close();
              }}
            />
          );
        })}
      </Sheet>

      {/* Quiet hours */}
      <Sheet visible={sheet === 'quiet'} onClose={close} title="Quiet hours" footer={<Button title="Done" onPress={close} />}>
        <ListGroup>
          <ListRow icon="moon" title="Quiet hours" subtitle="Safety alerts still come through" toggle={quietOn} onToggle={(v) => setNotificationPrefs({ quietEnabled: v })} last />
        </ListGroup>
        {quietOn && (
          <View style={{ marginTop: space.md }}>
            <AppText variant="label" color={colors.muted} style={{ marginBottom: space.xs }}>
              From
            </AppText>
            <Segmented options={QUIET_START} value={n.quietStart} onChange={(v) => setNotificationPrefs({ quietStart: v })} />
            <AppText variant="label" color={colors.muted} style={{ marginTop: space.md, marginBottom: space.xs }}>
              Until
            </AppText>
            <Segmented options={QUIET_END} value={n.quietEnd} onChange={(v) => setNotificationPrefs({ quietEnd: v })} />
          </View>
        )}
      </Sheet>

      {/* Blocked */}
      <Sheet visible={sheet === 'blocked'} onClose={close} title="Blocked people">
        <QueryState
          status={safetyQ.status}
          error={safetyQ.error}
          hasData={blockedPeople.length > 0}
          onRetry={safetyQ.reload}
          skeletonRows={2}
          skeletonHeight={56}
          empty={{ title: 'No one blocked', body: 'You can block anyone from their profile, a plan or a chat.', pose: 'wave' }}
        >
          <ListGroup>
            {blockedPeople.map((p, i) => (
              <View
                key={p.id}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: i === blockedPeople.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
              >
                <Avatar seed={p.avatarSeed || p.id} uri={p.avatarUrl} size={40} />
                <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1, marginHorizontal: space.sm }}>
                  {p.name}
                </AppText>
                <Button title="Unblock" size="xs" variant="secondary" full={false} loading={unblocking === p.id} disabled={!!unblocking} onPress={() => doUnblock(p.id)} />
              </View>
            ))}
          </ListGroup>
        </QueryState>
        {unblockError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {unblockError}
          </AppText>
        ) : null}
      </Sheet>

      {/* Log out */}
      <Sheet visible={sheet === 'logout'} onClose={() => !loggingOut && close()} title="Log out?">
        <AppText color={colors.inkSoft}>Your plans and chats stay saved. Log back in with your phone anytime.</AppText>
        {logoutError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {logoutError}
          </AppText>
        ) : null}
        <Button title="Log out" style={{ marginTop: space.lg }} loading={loggingOut} onPress={doLogout} />
        <Button title="Cancel" variant="ghost" disabled={loggingOut} style={{ marginTop: space.xs }} onPress={close} />
      </Sheet>

      {/* Delete */}
      <Sheet visible={sheet === 'delete'} onClose={() => !deleting && close()} title="Delete your account?">
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, gap: space.sm }}>
          {DELETE_FACTS.map(([icon, text]) => (
            <View key={icon} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name={icon} size={18} color={colors.inkSoft} />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.sm }}>
                {text}
              </AppText>
            </View>
          ))}
        </View>
        {deleteError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {deleteError}
          </AppText>
        ) : null}
        <Button title="Delete my account" variant="danger" loading={deleting} style={{ marginTop: space.lg }} onPress={doDelete} />
        <Button title="Keep my account" variant="ghost" disabled={deleting} style={{ marginTop: space.xs }} onPress={close} />
      </Sheet>
    </Screen>
  );
}
