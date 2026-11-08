// Safety toolkit — never behind a paywall.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  AppText,
  Avatar,
  Button,
  Card,
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
  Tag,
  TextField,
} from '@/components';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, radius, space } from '@/theme/tokens';
import { relativeDay } from '@/utils/format';
import haptics from '@/utils/haptics';
import { GUIDELINES, REPORT_STATUS, callEmergency, reasonTitle } from './shared';

const CHECKLIST = [
  ['map-pin', 'Meet at the public venue on the plan'],
  ['share-2', 'Tell a trusted contact where you’re going'],
  ['navigation', 'Arrive and leave on your own'],
  ['message-circle', 'Keep chat in the app until you’re comfortable'],
  ['heart', 'Trust your gut — you can leave anytime, no explanation needed'],
];

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
  const opened = useRef(false);

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
      setRemoveError(e.code === 'network' || e.code === 'timeout' ? "You're offline — couldn't remove that contact." : e.message || "Couldn't remove that contact. Try again.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Safety center" />} refreshControl={<RefreshControl refreshing={safetyQ.refreshing} onRefresh={safetyQ.reload} tintColor={colors.ink} />}>
      <HeroCard style={{ marginTop: space.xs }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: 10, bottom: 10, opacity: 0.3 }}>
          <Pictogram name="shield" size={84} strokeWidth={1.4} />
        </View>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
          <Pictogram name="shield" size={26} />
        </View>
        <AppText variant="h2" style={{ marginTop: space.sm }}>
          Meet in public.{'\n'}Leave anytime.
        </AppText>
        <AppText variant="caption" color={colors.inkSoft} style={{ marginTop: 4, maxWidth: '80%' }}>
          Every safety tool here is free for everyone, always.
        </AppText>
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.md }}>
          <Button title="Share my plan" icon="share-2" size="sm" full={false} onPress={() => nav.navigate('emergency_share')} />
          <Button title={`Call ${config.EMERGENCY_NUMBER_IN}`} icon="phone" size="sm" variant="light" full={false} onPress={callEmergency} />
        </View>
      </HeroCard>

      {/* Checklist */}
      <SectionHeader title="Before every meetup" />
      <ListGroup>
        {CHECKLIST.map(([icon, text], i) => {
          const on = !!checked[i];
          return (
            <Pressable
              key={text}
              onPress={() => {
                haptics.select();
                setChecked((c) => ({ ...c, [i]: !c[i] }));
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={text}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: i === CHECKLIST.length - 1 ? 0 : 1, borderBottomColor: colors.border }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}>
                <Icon name={icon} size={18} />
              </View>
              <AppText style={{ flex: 1 }} color={on ? colors.muted : colors.ink}>
                {text}
              </AppText>
              <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: on ? colors.ink : colors.border, backgroundColor: on ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on && <Icon name="check" size={14} color={colors.white} />}
              </View>
            </Pressable>
          );
        })}
      </ListGroup>

      {/* Trusted contacts */}
      <SectionHeader title="Trusted contacts" action="Add" onAction={() => setAdding(true)} />
      {trustedContacts.length ? (
        <ListGroup>
          {trustedContacts.map((c, i) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: i === trustedContacts.length - 1 ? 0 : 1, borderBottomColor: colors.border, opacity: removing === c.id ? 0.5 : 1 }}>
              <Avatar seed={c.phone || c.id} size={40} />
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">{c.name}</AppText>
                <AppText variant="caption" color={colors.muted}>
                  {c.phone}
                  {c.status === 'pending' ? ' · invite sent' : ''}
                </AppText>
              </View>
              <IconButton icon="x" size={36} variant="plain" accessibilityLabel={`Remove ${c.name}`} onPress={() => !removing && removeContact(c)} />
            </View>
          ))}
        </ListGroup>
      ) : safetyQ.status === 'ready' || safetyQ.status === 'error' ? (
        <Card elevated={false} bg={colors.surface} style={{ alignItems: 'flex-start' }}>
          <AppText variant="bodyStrong">{safetyQ.status === 'error' ? "Couldn't load your contacts" : 'No trusted contacts yet'}</AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {safetyQ.status === 'error' ? safetyQ.error || 'Check your connection.' : "Add someone you can send plan details to in one tap. They don't need the app."}
          </AppText>
          <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.sm }}>
            <Button title="Add a contact" icon="user-plus" size="sm" full={false} onPress={() => setAdding(true)} />
            {safetyQ.status === 'error' && <Button title="Retry" icon="refresh-cw" size="sm" variant="secondary" full={false} onPress={safetyQ.reload} />}
          </View>
        </Card>
      ) : (
        <QueryState status={safetyQ.status} hasData={false} skeletonRows={1} skeletonHeight={64}>
          {null}
        </QueryState>
      )}
      {removeError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          {removeError}
        </AppText>
      ) : null}

      {/* How it works */}
      <SectionHeader title="If something feels off" />
      <View style={{ gap: space.xs }}>
        <Card style={{ flexDirection: 'row' }} padding={14}>
          <Icon name="flag" size={18} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">Report</AppText>
            <AppText variant="caption" color={colors.muted}>
              From any profile, plan, chat message or circle. A person on our team reviews every report; serious ones are prioritised. The person isn't told who reported them.
            </AppText>
          </View>
        </Card>
        <Card style={{ flexDirection: 'row' }} padding={14}>
          <Icon name="slash" size={18} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">Block</AppText>
            <AppText variant="caption" color={colors.muted}>
              Instantly stops them seeing your plans or messaging you. They aren't notified. Undo anytime in Settings.
            </AppText>
          </View>
        </Card>
        <Card style={{ flexDirection: 'row' }} padding={14}>
          <Icon name="refresh-cw" size={18} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">Fair decisions & appeals</AppText>
            <AppText variant="caption" color={colors.muted}>
              Accounts may be limited while a report is reviewed. Everyone can see the outcome of their case and appeal it.
            </AppText>
          </View>
        </Card>
      </View>
      <Button title="Report something" icon="flag" variant="secondary" style={{ marginTop: space.md }} onPress={() => nav.navigate('report_flow')} />

      {/* My reports */}
      <SectionHeader title="My reports" />
      <QueryState
        status={safetyQ.status}
        error={safetyQ.error}
        hasData={reports.length > 0}
        onRetry={safetyQ.reload}
        skeletonRows={2}
        skeletonHeight={56}
        empty={{ title: 'No reports filed', body: 'Reports you file will show their status here.', pose: 'wave' }}
      >
        <ListGroup>
          {reports.map((r, i) => {
            const st = REPORT_STATUS[r.status] || REPORT_STATUS.open;
            return (
              <ListRow
                key={r.id}
                icon="file-text"
                title={reasonTitle(r.reasonCode)}
                subtitle={`Case ${String(r.id).slice(-6).toUpperCase()}${r.createdAt ? ` · ${relativeDay(r.createdAt)}` : ''}`}
                right={<Tag label={st.label} bg={st.bg} />}
                last={i === reports.length - 1}
              />
            );
          })}
        </ListGroup>
      </QueryState>

      {/* Guidelines */}
      <SectionHeader title="Community guidelines" action="Read all" onAction={() => setGuidelinesOpen(true)} />
      <Card elevated={false} bg={colors.surface} padding={14}>
        {GUIDELINES.slice(0, 3).map(([icon, title]) => (
          <View key={title} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <Icon name={icon} size={16} color={colors.inkSoft} />
            <AppText variant="label" style={{ marginLeft: space.xs }}>
              {title}
            </AppText>
          </View>
        ))}
      </Card>

      <Card elevated={false} bg={colors.ink} style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'center' }}>
        <Icon name="alert-triangle" color={colors.orange} />
        <AppText variant="caption" color={colors.white} style={{ flex: 1, marginLeft: space.sm }}>
          In immediate danger? Call {config.EMERGENCY_NUMBER_IN} first. Then tell us so we can act on the account.
        </AppText>
        <Button title="Call" size="xs" variant="light" full={false} onPress={callEmergency} />
      </Card>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add trusted contact">
        <TextField label="Name" value={name} onChangeText={(t) => { setName(t); setError(null); }} placeholder="e.g. Didi" autoCapitalize="words" />
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
        <Button title="Save contact" loading={saving} onPress={saveContact} />
      </Sheet>

      <Sheet visible={guidelinesOpen} onClose={() => setGuidelinesOpen(false)} title="Community guidelines">
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md }}>
          {GUIDELINES.map(([icon, title, body], i) => (
            <View key={title} style={{ flexDirection: 'row', paddingVertical: space.xs, borderBottomWidth: i === GUIDELINES.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <Icon name={icon} size={18} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: space.sm }}>
                <AppText variant="bodyStrong">{title}</AppText>
                <AppText variant="caption" color={colors.muted}>
                  {body}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
