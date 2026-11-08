import React, { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  AppText,
  Avatar,
  Button,
  Card,
  Icon,
  ListGroup,
  ListRow,
  OptionCard,
  QueryState,
  Screen,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Tag,
} from '@/components';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import pkg from '../../../package.json';
import { maskPhone, resetTo } from './navHelpers';

const LANGUAGES = ['English', 'हिन्दी (Hindi)', 'ગુજરાતી (Gujarati)'];
const TIER_LABEL = { free: 'Free', plus: 'Plus', pro: 'Pro', venue: 'Venue / Club' };

export default function AccountSettingsScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const session = useAppStore((s) => s.session);
  const prefs = useAppStore((s) => s.prefs);
  const blocked = useAppStore((s) => s.blocked);
  const users = useAppStore((s) => s.users);
  const tier = useAppStore((s) => s.subscription.tier) || 'free';
  const setPrefs = useAppStore((s) => s.setPrefs);
  const unblockUser = useAppStore((s) => s.unblockUser);
  const logout = useAppStore((s) => s.logout);
  const deleteAccount = useAppStore((s) => s.deleteAccount);

  // GET /me/blocks (+ reports, trusted contacts) and GET /me/subscription.
  const safetyQ = useLoader('safety', (s) => s.loadSafety());
  const subQ = useLoader('subscription', (s) => s.loadSubscription());

  const [sheet, setSheet] = useState(null); // language | blocked | logout | delete
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);
  const [unblocking, setUnblocking] = useState(null); // userId in flight
  const [unblockError, setUnblockError] = useState(null);

  useEffect(() => {
    if (route.params?.focus === 'delete') setSheet('delete');
  }, [route.params?.focus]);

  const blockedPeople = useMemo(() => blocked.map((id) => users[id] || { id, name: 'Blocked member' }), [blocked, users]);

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
      setDeleteError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Connect and try again." : e.message || "Couldn't start deletion. Try again.");
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
      setUnblockError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Try again when connected." : e.message || "Couldn't unblock. Try again.");
    } finally {
      setUnblocking(null);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Settings" />}>
      <SectionHeader title="Account" style={{ marginTop: space.sm }} />
      <ListGroup>
        <ListRow icon="smartphone" title="Phone number" subtitle={maskPhone(session.phone)} right={session.verified ? <Tag label="Verified" icon="check" bg={colors.mint} /> : null} />
        <ListRow icon="globe" title="App language" value={prefs.language} onPress={() => setSheet('language')} />
        <ListRow
          icon="star"
          title="Subscription"
          value={subQ.status === 'loading' && !tier ? '…' : TIER_LABEL[tier] || tier}
          subtitle={subQ.status === 'error' ? "Couldn't refresh — showing last known plan" : undefined}
          onPress={() => nav.navigate('subscription_manage')}
          last
        />
      </ListGroup>

      <SectionHeader title="Experience" />
      <ListGroup>
        <ListRow icon="zap" title="Haptics" subtitle="Small vibrations on taps and rewards" toggle={prefs.haptics} onToggle={(v) => setPrefs({ haptics: v })} />
        <ListRow icon="volume-2" title="Sounds" subtitle="Off by default" toggle={prefs.sound} onToggle={(v) => setPrefs({ sound: v })} />
        <ListRow
          icon="calendar"
          title="Daily streak"
          subtitle="Optional. Weekly goals stay the default."
          toggle={prefs.dailyStreakOptIn}
          onToggle={(v) => setPrefs({ dailyStreakOptIn: v })}
          last
        />
      </ListGroup>

      <SectionHeader title="Privacy & safety" />
      <ListGroup>
        <ListRow icon="lock" title="Privacy controls" onPress={() => nav.navigate('privacy_controls')} />
        <ListRow icon="shield" title="Safety center" onPress={() => nav.navigate('safety_center')} />
        <ListRow
          icon="slash"
          title="Blocked people"
          value={safetyQ.status === 'loading' && !blocked.length ? '…' : String(blocked.length)}
          onPress={() => setSheet('blocked')}
          last
        />
      </ListGroup>

      <SectionHeader title="Help" />
      <ListGroup>
        <ListRow icon="book-open" title="Community guidelines" onPress={() => nav.navigate('safety_center', { section: 'guidelines' })} />
        <ListRow
          icon="mail"
          title="Grievance officer & support"
          subtitle={config.SUPPORT_EMAIL}
          onPress={() => Linking.openURL(`mailto:${config.SUPPORT_EMAIL}?subject=Project%20IRL%20support`).catch(() => {})}
          last
        />
      </ListGroup>

      <SectionHeader title="Session" />
      <ListGroup>
        <ListRow icon="log-out" title="Log out" onPress={() => setSheet('logout')} />
        <ListRow icon="trash-2" title="Delete account" danger onPress={() => setSheet('delete')} last />
      </ListGroup>

      <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xl }}>
        Project IRL {pkg.version} · Made for real life
      </AppText>

      {/* Language */}
      <Sheet visible={sheet === 'language'} onClose={() => setSheet(null)} title="App language">
        {LANGUAGES.map((l) => {
          const v = l.split(' ')[0] === 'English' ? 'English' : l;
          return <OptionCard key={l} title={l} selected={prefs.language === v} onPress={() => { setPrefs({ language: v }); setSheet(null); }} />;
        })}
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
          More Indian languages are on the way.
        </AppText>
      </Sheet>

      {/* Blocked */}
      <Sheet visible={sheet === 'blocked'} onClose={() => setSheet(null)} title="Blocked people">
        <QueryState
          status={safetyQ.status}
          error={safetyQ.error}
          hasData={blockedPeople.length > 0}
          onRetry={safetyQ.reload}
          skeletonRows={2}
          skeletonHeight={56}
          empty={{ title: 'No one blocked', body: 'If someone makes you uncomfortable, you can block them from their profile, a plan or a chat.', pose: 'wave' }}
        >
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: space.md }}>
            {blockedPeople.map((p, i) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: i === blockedPeople.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                <Avatar seed={p.avatarSeed || p.id} uri={p.avatarUrl} size={40} />
                <AppText variant="bodyStrong" style={{ flex: 1, marginLeft: space.sm }}>
                  {p.name}
                </AppText>
                <Button title="Unblock" size="xs" variant="secondary" full={false} loading={unblocking === p.id} disabled={!!unblocking} onPress={() => doUnblock(p.id)} />
              </View>
            ))}
          </View>
        </QueryState>
        {unblockError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {unblockError}
          </AppText>
        ) : null}
      </Sheet>

      {/* Logout */}
      <Sheet visible={sheet === 'logout'} onClose={() => !loggingOut && setSheet(null)} title="Log out?">
        <AppText color={colors.inkSoft}>Your plans, chats and progress stay saved to your account. Log back in with your phone number anytime.</AppText>
        {logoutError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {logoutError}
          </AppText>
        ) : null}
        <Button title="Log out" style={{ marginTop: space.lg }} loading={loggingOut} onPress={doLogout} />
        <Button title="Cancel" variant="ghost" disabled={loggingOut} style={{ marginTop: space.xs }} onPress={() => setSheet(null)} />
      </Sheet>

      {/* Delete */}
      <Sheet visible={sheet === 'delete'} onClose={() => !deleting && setSheet(null)} title="Delete your account?">
        <Card elevated={false} padding={space.md}>
          {[
            ['clock', 'Deletion is scheduled for 30 days from now. Log in before then to cancel it.'],
            ['eye-off', 'Your profile disappears from discovery immediately and hosted plans are cancelled.'],
            ['shield', 'Safety reports and records we must keep by law are retained, then deleted.'],
            ['credit-card', 'App Store / Play subscriptions must be cancelled in your store account.'],
          ].map(([icon, text]) => (
            <View key={icon} style={{ flexDirection: 'row', marginBottom: space.sm }}>
              <Icon name={icon} size={16} color={colors.inkSoft} style={{ marginTop: 2 }} />
              <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
                {text}
              </AppText>
            </View>
          ))}
        </Card>
        {deleteError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: space.sm }}>
            {deleteError}
          </AppText>
        ) : null}
        <Button title="Delete my account" variant="danger" loading={deleting} style={{ marginTop: space.lg }} onPress={doDelete} />
        <Button title="Keep my account" variant="ghost" disabled={deleting} style={{ marginTop: space.xs }} onPress={() => setSheet(null)} />
      </Sheet>
    </Screen>
  );
}
