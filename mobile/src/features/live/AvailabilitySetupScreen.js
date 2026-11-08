// availability_setup (modal) — Available now / later / busy + activity intents.
// Saves with PUT /me/availability and only closes once the server accepted it.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, Icon, OptionCard, Screen, ScreenHeader, SectionHeader } from '@/components';
import { categories } from '@/data/catalog';
import { me as meApi } from '@/api/endpoints';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { timeLabel } from '@/utils/format';
import { MODAL_EDGES } from '@/features/discover/utils';

const STATUSES = [
  { value: 'now', title: 'Available now', subtitle: 'Show up in nearby radars and plan suggestions', color: colors.success },
  { value: 'later', title: 'Later today', subtitle: 'Let people know you’re free this evening', color: colors.warning },
  { value: 'busy', title: 'Busy', subtitle: 'Hide my availability. Browsing still works.', color: colors.muted },
];

const DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 'tonight', label: 'Until tonight' },
];

function untilFor(d, status) {
  if (status === 'busy') return null;
  const t = new Date();
  if (d === 'tonight' || status === 'later') {
    t.setHours(22, 0, 0, 0);
    return t.toISOString();
  }
  return new Date(Date.now() + d * 60000).toISOString();
}

export default function AvailabilitySetupScreen() {
  const nav = useNavigation();
  const availability = useAppStore((s) => s.availability);
  const interests = useAppStore((s) => s.profile.interests);
  const area = useAppStore((s) => s.profile.area);

  const current = availability.activities || [];
  const [status, setStatus] = useState(availability.status === 'busy' ? 'now' : availability.status || 'now');
  const [duration, setDuration] = useState(60);
  const [intents, setIntents] = useState(current.length ? current : interests.slice(0, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ordered = [...categories].sort((a, b) => (interests.includes(b.slug) ? 1 : 0) - (interests.includes(a.slug) ? 1 : 0));
  const toggle = (slug) => setIntents((x) => (x.includes(slug) ? x.filter((s) => s !== slug) : x.length >= 4 ? x : [...x, slug]));
  const until = untilFor(duration, status);

  const save = async () => {
    const next = { ...availability, status, until, activities: status === 'busy' ? [] : intents };
    setBusy(true);
    setError(null);
    try {
      const saved = await meApi.setAvailability(next);
      // Mirror the server's answer locally (store.setAvailability would PUT again).
      useAppStore.setState({ availability: saved && saved.status ? saved : next });
      useAppStore.getState().loadNearbyPeople().catch(() => null);
      nav.goBack();
    } catch (e) {
      setError(e?.code === 'network' || e?.code === 'timeout' ? 'No connection — your availability wasn’t changed.' : e?.message || 'Couldn’t save. Try again.');
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
            <AppText variant="caption" color={colors.danger} align="center" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          <Button title={status === 'busy' ? 'Set to busy' : `Go available${until ? ` until ${timeLabel(until)}` : ''}`} loading={busy} onPress={save} />
        </View>
      }
    >
      <AppText variant="h1" style={{ marginTop: space.xs }}>
        Free to do something?
      </AppText>
      <AppText color={colors.muted} style={{ marginTop: 4 }}>
        Let plans {area ? `near ${area} ` : 'nearby '}find you. You can switch back to busy any time.
      </AppText>

      <View style={{ marginTop: space.lg }} accessibilityRole="radiogroup">
        {STATUSES.map((s) => (
          <OptionCard
            key={s.value}
            title={s.title}
            subtitle={s.subtitle}
            selected={status === s.value}
            onPress={() => setStatus(s.value)}
            left={<View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: s.color, marginLeft: 4 }} />}
          />
        ))}
      </View>

      {status === 'now' && (
        <>
          <SectionHeader title="For how long?" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {DURATIONS.map((d) => (
              <Chip key={String(d.value)} label={d.label} icon="clock" selected={duration === d.value} onPress={() => setDuration(d.value)} />
            ))}
          </View>
        </>
      )}

      {status !== 'busy' && (
        <>
          <SectionHeader title="Up for…" right={<AppText variant="caption" color={colors.muted}>{intents.length}/4</AppText>} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {ordered.map((c) => (
              <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={intents.includes(c.slug)} onPress={() => toggle(c.slug)} />
            ))}
          </View>
          {intents.length === 0 && (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
              Nothing picked = open to anything nearby.
            </AppText>
          )}
        </>
      )}

      <View style={{ flexDirection: 'row', backgroundColor: colors.periwinkleWash, borderRadius: radius.quest, padding: space.md, marginTop: space.xl }}>
        <Icon name="shield" size={18} color={colors.deep} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          Others see only your first name, what you’re up for and a coarse area (~1 km). Never your exact location, and nobody can message you until you’re both in an accepted plan.
        </AppText>
      </View>
    </Screen>
  );
}
