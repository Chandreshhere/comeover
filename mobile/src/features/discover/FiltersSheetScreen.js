// filters_sheet (modal) — distance, time, group size, level, accessibility, cost,
// categories. Apply stores the filters and re-queries GET /activities.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, ListGroup, ListRow, Screen, ScreenHeader, SectionHeader } from '@/components';
import { categories } from '@/data/catalog';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import { colors, space } from '@/theme/tokens';
import { GROUP_OPTIONS, LEVEL_OPTIONS, MODAL_EDGES, WHEN_OPTIONS, applyFilters, visibleActivities } from './utils';

const DEFAULTS = { distanceKm: config.DEFAULT_RADIUS_KM, when: 'any', groupSize: 'any', level: 'any', accessible: false, freeOnly: false, categories: [] };

function Group({ title, options, value, onChange }) {
  return (
    <>
      <SectionHeader title={title} style={{ marginTop: space.lg }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </>
  );
}

export default function FiltersSheetScreen() {
  const nav = useNavigation();
  const stored = useAppStore((s) => s.filters);
  const activities = useAppStore((s) => s.activities);
  const blocked = useAppStore((s) => s.blocked);
  const setFilters = useAppStore((s) => s.setFilters);
  const loadFeed = useAppStore((s) => s.loadFeed);

  const [f, setF] = useState({ ...DEFAULTS, ...stored });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  // Local estimate from plans already loaded; the server returns the real list on Apply.
  const estimate = useMemo(() => applyFilters(visibleActivities(activities, { blocked }), f).length, [activities, blocked, f]);

  const toggleCat = (slug) => set({ categories: f.categories.includes(slug) ? f.categories.filter((c) => c !== slug) : [...f.categories, slug] });

  const apply = async () => {
    setBusy(true);
    setError(null);
    const prev = stored;
    setFilters(f);
    try {
      await loadFeed();
      nav.goBack();
    } catch (e) {
      setFilters(prev);
      setError(e?.code === 'network' || e?.code === 'timeout' ? 'No connection — filters not applied. Try again.' : e?.message || 'Couldn’t load plans with these filters.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      bg={colors.canvas}
      edges={MODAL_EDGES}
      header={<ScreenHeader title="Filters" onBack={() => nav.goBack()} right={<AppText variant="label" color={colors.deep} onPress={() => setF({ ...DEFAULTS })} accessibilityRole="button">Reset</AppText>} />}
      footer={
        <View style={{ gap: space.xs }}>
          {!!error && (
            <AppText variant="caption" color={colors.danger} align="center" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          <Button title="Show plans" loading={busy} onPress={apply} />
          <AppText variant="caption" color={colors.muted} align="center">
            {estimate ? `About ${estimate} of the plans already loaded match` : 'We’ll search nearby with these filters'}
          </AppText>
        </View>
      }
    >
      <Group
        title="Distance"
        options={config.RADIUS_OPTIONS_KM.map((km) => ({ value: km, label: `Within ${km} km` }))}
        value={f.distanceKm}
        onChange={(v) => set({ distanceKm: v })}
      />
      <AppText variant="caption" color={colors.muted} style={{ marginTop: 6 }}>
        Distances are approximate. Nobody ever sees your exact location.
      </AppText>
      <Group title="When" options={WHEN_OPTIONS} value={f.when} onChange={(v) => set({ when: v })} />
      <Group title="Group size" options={GROUP_OPTIONS} value={f.groupSize} onChange={(v) => set({ groupSize: v })} />
      <Group title="Activity level" options={LEVEL_OPTIONS} value={f.level} onChange={(v) => set({ level: v })} />

      <SectionHeader title="Needs" style={{ marginTop: space.lg }} />
      <ListGroup>
        <ListRow icon="navigation" title="Accessibility info listed" subtitle="Step-free access and other notes from the host" toggle={f.accessible} onToggle={(v) => set({ accessible: v })} />
        <ListRow icon="tag" title="Free plans only" subtitle="No entry fees or table charges" toggle={f.freeOnly} onToggle={(v) => set({ freeOnly: v })} last />
      </ListGroup>

      <SectionHeader title="Activities" style={{ marginTop: space.lg }} right={f.categories.length ? <AppText variant="label" color={colors.deep} onPress={() => set({ categories: [] })}>Any</AppText> : null} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {categories.map((c) => (
          <Chip key={c.slug} label={c.short} pictogram={c.pictogram} selected={f.categories.includes(c.slug)} onPress={() => toggleCat(c.slug)} />
        ))}
      </View>
      <AppText variant="caption" color={colors.muted} style={{ marginTop: space.lg }}>
        Age-range filters are only offered where lawful and never used to hide safety tools.
      </AppText>
    </Screen>
  );
}
