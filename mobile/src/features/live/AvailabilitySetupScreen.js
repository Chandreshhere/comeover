// availability_setup (modal) — Available now / later / busy, what I'm up for,
// and whether I show on the radar. Status + activities save with
// PUT /me/availability (the screen only closes once the server accepted it);
// radar visibility is the `showOnRadar` pref and applies straight away.
import React, { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Button,
  Card,
  Chip,
  ChipGrid,
  Icon,
  OptionCard,
  Screen,
  ScreenHeader,
  SectionHeader,
  Tag,
} from '@/components';
import { categories } from '@/data/catalog';
import { me as meApi } from '@/api/endpoints';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import { enter } from '@/theme/motion';
import { timeLabel } from '@/utils/format';
import { MODAL_EDGES } from '@/features/discover/utils';
import Toggle from './components/Toggle';

const MAX_INTENTS = 4;
const BUBBLE = 40;

// A function, not a constant: it reads the live (light/dark) palette.
const statuses = () => [
  { value: 'now', title: 'Available now', subtitle: 'Show up on nearby radars', icon: 'radio', bg: colors.mint },
  {
    value: 'later',
    title: 'Later today',
    subtitle: 'Let people know you’re free this evening',
    icon: 'sunset',
    bg: colors.lavender,
  },
  {
    value: 'busy',
    title: 'Busy',
    subtitle: 'Hide my availability. Browsing still works.',
    icon: 'pause-circle',
    bg: colors.surfaceSubtle,
  },
];

const DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 'tonight', label: 'Until tonight' },
];

function untilFor(d, status) {
  if (status === 'busy') return null;
  const now = Date.now();
  if (d === 'tonight' || status === 'later') {
    const t = new Date();
    t.setHours(22, 0, 0, 0);
    // Already late in the evening: keep it a short, still-future window.
    return (t.getTime() - now < 30 * 60000 ? new Date(now + 2 * 3600000) : t).toISOString();
  }
  return new Date(now + d * 60000).toISOString();
}

function Bubble({ icon, bg }) {
  return (
    <View
      style={{
        width: BUBBLE,
        height: BUBBLE,
        borderRadius: BUBBLE / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={20} color={colors.ink} weight="duotone" />
    </View>
  );
}

export default function AvailabilitySetupScreen() {
  const nav = useNavigation();
  const availability = useAppStore((s) => s.availability);
  const interests = useAppStore((s) => s.profile.interests);
  const area = useAppStore((s) => s.profile.area);
  const showOnRadar = useAppStore((s) => s.prefs.showOnRadar);
  const setPrefs = useAppStore((s) => s.setPrefs);

  const current = availability.activities || [];
  const [status, setStatus] = useState(availability.status === 'busy' ? 'now' : availability.status || 'now');
  const [duration, setDuration] = useState(60);
  const [intents, setIntents] = useState(current.length ? current : interests.slice(0, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ordered = [...categories].sort(
    (a, b) => (interests.includes(b.slug) ? 1 : 0) - (interests.includes(a.slug) ? 1 : 0)
  );
  const toggle = (slug) =>
    setIntents((x) => (x.includes(slug) ? x.filter((s) => s !== slug) : x.length >= MAX_INTENTS ? x : [...x, slug]));
  const until = untilFor(duration, status);
  const full = intents.length >= MAX_INTENTS;

  const save = async () => {
    const next = { ...availability, status, until, activities: status === 'busy' ? [] : intents };
    setBusy(true);
    setError(null);
    try {
      const saved = await meApi.setAvailability(next);
      // Mirror the server's answer locally (store.setAvailability would PUT again).
      useAppStore.setState({ availability: saved && saved.status ? saved : next });
      useAppStore
        .getState()
        .loadNearbyPeople()
        .catch(() => null);
      nav.goBack();
    } catch (e) {
      setError(
        e?.code === 'network' || e?.code === 'timeout'
          ? 'No connection. Your availability wasn’t changed.'
          : e?.message || 'Couldn’t save. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      bg={colors.canvas}
      edges={MODAL_EDGES}
      header={<ScreenHeader title="Your availability" onBack={() => nav.goBack()} />}
      footer={
        <View style={{ gap: space.xs }}>
          {!!error && (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
              accessibilityLiveRegion="polite"
            >
              <Icon name="alert-circle" size={14} color={colors.danger} />
              <AppText variant="caption" color={colors.danger} style={{ marginLeft: space.xxs, flexShrink: 1 }}>
                {error}
              </AppText>
            </View>
          )}
          <Button
            title={status === 'busy' ? 'Set to busy' : `Go available${until ? ` until ${timeLabel(until)}` : ''}`}
            icon={status === 'busy' ? 'pause-circle' : 'radio'}
            loading={busy}
            onPress={save}
          />
        </View>
      }
    >
      <AppText color={colors.muted} style={{ marginTop: space.xs }}>
        Let plans {area ? `near ${area}` : 'nearby'} find you.
      </AppText>

      <View style={{ marginTop: space.md }} accessibilityRole="radiogroup">
        {statuses().map((s, i) => (
          <Animated.View key={s.value} entering={enter(i)}>
            <OptionCard
              title={s.title}
              subtitle={s.subtitle}
              selected={status === s.value}
              onPress={() => setStatus(s.value)}
              left={<Bubble icon={s.icon} bg={s.bg} />}
            />
          </Animated.View>
        ))}
      </View>

      {status === 'now' && (
        <>
          <SectionHeader title="For how long?" />
          <ChipGrid columns={2}>
            {DURATIONS.map((d) => (
              <Chip
                key={String(d.value)}
                label={d.label}
                fill
                selected={duration === d.value}
                onPress={() => setDuration(d.value)}
              />
            ))}
          </ChipGrid>
        </>
      )}

      {status !== 'busy' && (
        <>
          <SectionHeader
            title="Up for…"
            right={
              <Tag
                label={`${intents.length}/${MAX_INTENTS}`}
                bg={full ? colors.ink : colors.surface}
                fg={full ? colors.white : colors.inkSoft}
              />
            }
          />
          <ChipGrid columns={2}>
            {ordered.map((c) => (
              <Chip
                key={c.slug}
                label={c.short}
                pictogram={c.pictogram}
                fill
                selected={intents.includes(c.slug)}
                onPress={() => toggle(c.slug)}
              />
            ))}
          </ChipGrid>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
            {intents.length === 0
              ? 'Nothing picked = open to anything nearby.'
              : full
              ? 'That’s the max. Tap one to remove it.'
              : `Pick up to ${MAX_INTENTS}.`}
          </AppText>
        </>
      )}

      {/* Radar visibility (the showOnRadar pref) — applies immediately */}
      <SectionHeader title="Visibility" />
      <Card padding={space.md} elevated={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Bubble icon={showOnRadar ? 'eye' : 'eye-off'} bg={colors.periwinkleWash} />
          <View style={{ flex: 1, marginHorizontal: space.sm }}>
            <AppText variant="bodyStrong">Show me on the radar</AppText>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
              {status === 'busy'
                ? 'You’re hidden while busy.'
                : 'Others see what you’re up for and a ~1 km area, never your exact spot.'}
            </AppText>
          </View>
          <Toggle
            value={showOnRadar}
            onValueChange={(v) => setPrefs({ showOnRadar: v })}
            accessibilityLabel="Show me on the radar"
          />
        </View>
      </Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm }}>
        <Icon name="shield" size={14} color={colors.muted} weight="duotone" />
        <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: space.xs }}>
          Nobody can message you until you’re both in an accepted plan.
        </AppText>
      </View>
    </Screen>
  );
}
