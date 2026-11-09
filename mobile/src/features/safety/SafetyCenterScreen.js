// Safety toolkit — never behind a paywall. Calm and scannable:
// 1) share my plan + emergency call, 2) before-you-go checklist,
// 3) trusted contacts, 4) reports & guidelines (details open in sheets).
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Footprints } from 'phosphor-react-native/src/icons/Footprints';
import { Scales } from 'phosphor-react-native/src/icons/Scales';
import {
  AppText,
  Avatar,
  Button,
  HeroCard,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  Pictogram,
  QueryState,
  Screen,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Skeleton,
  Tag,
  TextField,
  usePressScale,
} from '@/components';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { relativeDay } from '@/utils/format';
import haptics from '@/utils/haptics';
import IconBubble from '@/features/system/IconBubble';
import { EmergencyRow, GUIDELINES, reasonTitle, reportStatus } from './shared';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// [icon, text, bubble tone]
const CHECKLIST = [
  ['map-pin', 'Meet at the plan’s public venue', 'periwinkle'],
  ['share-2', 'Tell someone where you’re going', 'orange'],
  [Footprints, 'Get there and back on your own', 'mint'],
  ['chats', 'Keep chat in the app at first', 'lavender'],
  ['heart', 'Trust your gut. Leave anytime', 'pink'],
];

// [icon, tone, title, one-line body]
const HOW_IT_WORKS = [
  ['flag', 'pink', 'Report', 'A person reviews every report. They’re not told it was you.'],
  ['slash', 'orange', 'Block', 'Instant and private. Undo anytime in Settings.'],
  [Scales, 'lavender', 'Fair decisions', 'Everyone sees the outcome of their case and can appeal.'],
];

// iOS keyboard height. The shared Sheet is bottom-anchored inside a Modal and
// doesn't avoid the keyboard itself, so the add-contact form pads by this much
// to keep its fields and Save button just above the keys. (Android resizes the
// modal window on its own.)
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const a = Keyboard.addListener('keyboardWillShow', (e) => setH(e.endCoordinates?.height || 0));
    const b = Keyboard.addListener('keyboardWillHide', () => setH(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return h;
}

// Checklist row: tap to tick; text dims once done.
function CheckItem({ icon, text, tone, on, last, onToggle }) {
  const press = usePressScale(0.97);
  return (
    <AnimatedPressable
      onPress={onToggle}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={text}
      style={[{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, minHeight: 56, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }, press.style]}
    >
      <IconBubble icon={icon} tone={on ? 'neutral' : tone} size={36} iconSize={18} square style={{ marginRight: space.sm }} />
      <AppText style={{ flex: 1, marginRight: space.sm }} color={on ? colors.muted : colors.ink}>
        {text}
      </AppText>
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? colors.success : colors.border, backgroundColor: on ? colors.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on && <Icon name="check" size={14} color={colors.pureWhite} />}
      </View>
    </AnimatedPressable>
  );
}

export default function SafetyCenterScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const scrollTarget = route.params?.section;
  const trustedContacts = useAppStore((s) => s.trustedContacts);
  const addTrustedContact = useAppStore((s) => s.addTrustedContact);
  const removeTrustedContact = useAppStore((s) => s.removeTrustedContact);
  const reports = useAppStore((s) => s.reports);
  // GET /me/blocks + /me/reports + /trusted-contacts
  const safetyQ = useLoader('safety', (s) => s.loadSafety());
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);

  const [checked, setChecked] = useState({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const opened = useRef(false);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // The sheet already pads the home-indicator area, which the keyboard covers too.
  const sheetKeyboardPad = keyboardHeight ? Math.max(0, keyboardHeight - insets.bottom - space.md + space.sm) : 0;

  useEffect(() => {
    if (scrollTarget === 'guidelines' && !opened.current) {
      opened.current = true;
      setGuidelinesOpen(true);
    }
  }, [scrollTarget]);

  const saveContact = async () => {
    const digits = phone.replace(/\D/g, '');
    const local = digits.length > 10 ? digits.slice(-10) : digits;
    if (!name.trim()) return setError('Add their name');
    if (!/^[6-9]\d{9}$/.test(local)) return setError('Enter a valid 10-digit Indian mobile number');
    setSaving(true);
    try {
      await addTrustedContact({ name: name.trim(), phone: `+91${local}` });
      haptics.success();
      setAdding(false);
      setName('');
      setPhone('');
      setError(null);
    } catch (e) {
      setError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Try again when connected." : e.message || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
    return null;
  };

  const removeContact = async (c) => {
    setRemoving(c.id);
    setRemoveError(null);
    try {
      await removeTrustedContact(c.id);
    } catch (e) {
      setRemoveError(e.code === 'network' || e.code === 'timeout' ? "You're offline. Couldn't remove that contact." : e.message || "Couldn't remove that contact. Try again.");
    } finally {
      setRemoving(null);
    }
  };

  const loaded = safetyQ.status === 'ready' || safetyQ.status === 'error';
  const latest = reports[0];
  const reportsSubtitle = latest ? `Latest: ${reportStatus(latest.status).label}` : safetyQ.status === 'error' ? "Couldn't load" : 'None filed';

  return (
    <Screen header={<ScreenHeader title="Safety center" />} refreshControl={<RefreshControl refreshing={safetyQ.refreshing} onRefresh={safetyQ.reload} tintColor={colors.ink} />}>
      {/* 1. The two things that matter most: share the plan, call for help */}
      <HeroCard style={{ marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name="shield" size={26} color={colors.ink} duotoneColor={colors.success} duotoneOpacity={0.45} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="h2" accessibilityRole="header">
              Meet in public. Leave anytime.
            </AppText>
          </View>
        </View>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: space.sm }}>
          Every safety tool here is free, always.
        </AppText>
        <Button title="Share my plan" icon="share-2" size="sm" full={false} style={{ marginTop: space.md }} onPress={() => nav.navigate('emergency_share')} />
      </HeroCard>

      <EmergencyRow style={{ marginTop: space.sm }} />

      {/* 2. Checklist */}
      <SectionHeader title="Before you go" />
      <ListGroup>
        {CHECKLIST.map(([icon, text, tone], i) => (
          <CheckItem
            key={text}
            icon={icon}
            text={text}
            tone={tone}
            on={!!checked[i]}
            last={i === CHECKLIST.length - 1}
            onToggle={() => {
              haptics.select();
              setChecked((c) => ({ ...c, [i]: !c[i] }));
            }}
          />
        ))}
      </ListGroup>

      {/* 3. Trusted contacts */}
      <SectionHeader title="Trusted contacts" action={trustedContacts.length ? 'Add' : undefined} onAction={() => setAdding(true)} />
      {trustedContacts.length ? (
        <ListGroup>
          {trustedContacts.map((c, i) => (
            <View
              key={c.id}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, minHeight: 64, borderBottomWidth: i === trustedContacts.length - 1 ? 0 : 1, borderBottomColor: colors.border, opacity: removing === c.id ? 0.5 : 1 }}
            >
              <Avatar seed={c.phone || c.id} size={40} />
              <View style={{ flex: 1, marginHorizontal: space.sm }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {c.name}
                </AppText>
                <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                  {c.phone}
                  {c.status === 'pending' ? ' · invite sent' : ''}
                </AppText>
              </View>
              <IconButton icon="x" size={36} variant="plain" accessibilityLabel={`Remove ${c.name}`} onPress={() => !removing && removeContact(c)} />
            </View>
          ))}
        </ListGroup>
      ) : loaded ? (
        <ListGroup>
          {safetyQ.status === 'error' ? (
            <ListRow icon="cloud-off" title="Couldn't load contacts" subtitle={safetyQ.error || 'Check your connection.'} onPress={safetyQ.reload} right={<AppText variant="label" color={colors.deep}>Retry</AppText>} last />
          ) : (
            <ListRow icon="user-plus" title="Add a trusted contact" subtitle="They get your plan details in one tap" onPress={() => setAdding(true)} last />
          )}
        </ListGroup>
      ) : (
        <Skeleton height={64} r={radius.card} />
      )}
      {removeError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          {removeError}
        </AppText>
      ) : null}

      {/* 4. Reports & guidelines — details open in sheets */}
      <SectionHeader title="If something feels off" />
      <ListGroup>
        <ListRow icon="flag" title="Report something" subtitle="Reviewed by a person, kept private" onPress={() => nav.navigate('report_flow')} />
        <ListRow icon="file-text" title="My reports" subtitle={reportsSubtitle} value={reports.length ? String(reports.length) : undefined} onPress={() => setReportsOpen(true)} />
        <ListRow icon="book-open" title="Community guidelines" subtitle="Platonic, public and respectful" onPress={() => setGuidelinesOpen(true)} last />
      </ListGroup>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add trusted contact">
        <View style={{ paddingBottom: sheetKeyboardPad }}>
          <TextField label="Name" value={name} onChangeText={(t) => { setName(t); setError(null); }} placeholder="e.g. Didi" autoCapitalize="words" autoFocus />
          <TextField
            label="Mobile number"
            value={phone}
            onChangeText={(t) => { setPhone(t); setError(null); }}
            keyboardType="phone-pad"
            placeholder="98765 43210"
            maxLength={14}
            error={error}
            helper="We only text them when you choose to share a plan."
          />
          <Button title="Save contact" icon="user-plus" loading={saving} onPress={saveContact} />
        </View>
      </Sheet>

      <Sheet visible={reportsOpen} onClose={() => setReportsOpen(false)} title="My reports">
        <ScrollView showsVerticalScrollIndicator={false}>
          <QueryState
            status={safetyQ.status}
            error={safetyQ.error}
            hasData={reports.length > 0}
            onRetry={safetyQ.reload}
            skeletonRows={2}
            skeletonHeight={56}
            empty={{ title: 'No reports filed', body: 'Reports you file show their status here.', pose: 'wave' }}
          >
            <ListGroup>
              {reports.map((r, i) => {
                const st = reportStatus(r.status);
                return (
                  <ListRow
                    key={r.id}
                    icon="file-text"
                    title={reasonTitle(r.reasonCode)}
                    subtitle={`Case ${String(r.id).slice(-6).toUpperCase()}${r.createdAt ? ` · ${relativeDay(r.createdAt)}` : ''}`}
                    right={<Tag label={st.label} bg={st.bg} fg={colors.ink} style={{ alignSelf: 'center' }} />}
                    last={i === reports.length - 1}
                  />
                );
              })}
            </ListGroup>
          </QueryState>
          <AppText variant="h3" style={{ marginTop: space.lg, marginBottom: space.sm }} accessibilityRole="header">
            How it works
          </AppText>
          <ListGroup>
            {HOW_IT_WORKS.map(([icon, tone, title, body], i) => (
              <View key={title} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, borderBottomWidth: i === HOW_IT_WORKS.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                <IconBubble icon={icon} tone={tone} size={36} iconSize={18} />
                <View style={{ flex: 1, marginLeft: space.sm }}>
                  <AppText variant="bodyStrong">{title}</AppText>
                  <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                    {body}
                  </AppText>
                </View>
              </View>
            ))}
          </ListGroup>
        </ScrollView>
      </Sheet>

      <Sheet visible={guidelinesOpen} onClose={() => setGuidelinesOpen(false)} title="Community guidelines">
        <ScrollView style={{ backgroundColor: colors.surface, borderRadius: radius.card }} contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.xs }} showsVerticalScrollIndicator={false}>
          {GUIDELINES.map(([icon, title, body, tone], i) => (
            <View key={title} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.sm, borderBottomWidth: i === GUIDELINES.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <IconBubble icon={icon} tone={tone} size={36} iconSize={18} />
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">{title}</AppText>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                  {body}
                </AppText>
              </View>
            </View>
          ))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
