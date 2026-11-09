// filters_sheet (modal) — distance, time and activities up front; group size,
// level, accessibility and cost under "More filters". Apply stores the filters
// and re-queries GET /activities.
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Chip, ChipGrid, Icon, ListGroup, ListRow, Screen, ScreenHeader, SectionHeader, Segmented } from '@/components';
import { categories } from '@/data/catalog';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import { colors, radius, space } from '@/theme/tokens';
import { fadeIn } from '@/theme/motion';
import { GROUP_OPTIONS, LEVEL_OPTIONS, MODAL_EDGES, WHEN_OPTIONS, applyFilters, visibleActivities } from './utils';

const DEFAULTS = { distanceKm: config.DEFAULT_RADIUS_KM, when: 'any', groupSize: 'any', level: 'any', accessible: false, freeOnly: false, categories: [] };

// Small text action with a ~44pt tap target via hitSlop, so it never changes
// the height of the row it sits in (header "Reset", section "Any").
function TextAction({ label, onPress, accessibilityLabel }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }} style={{ paddingVertical: 2 }}>
      <AppText variant="label" color={colors.deep}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Options({ label, options, value, onChange }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ChipGrid columns={2}>
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} fill selected={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </ChipGrid>
    </View>
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

  // "More filters" starts open when any of them is already set.
  const moreCount = (f.groupSize !== 'any' ? 1 : 0) + (f.level !== 'any' ? 1 : 0) + (f.accessible ? 1 : 0) + (f.freeOnly ? 1 : 0);
  const [moreOpen, setMoreOpen] = useState(moreCount > 0);

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
      setError(e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Filters not applied.' : e?.message || 'Couldn’t load plans with these filters.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      bg={colors.canvas}
      edges={MODAL_EDGES}
      header={<ScreenHeader title="Filters" onBack={() => nav.goBack()} right={<TextAction label="Reset" accessibilityLabel="Reset all filters" onPress={() => setF({ ...DEFAULTS })} />} />}
      footer={
        <View style={{ gap: space.xs }}>
          {!!error && (
            <AppText variant="caption" color={colors.danger} align="center" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          )}
          <Button title="Show plans" loading={busy} onPress={apply} />
          <AppText variant="caption" color={colors.muted} align="center">
            {estimate ? `About ${estimate} loaded plan${estimate === 1 ? '' : 's'} match` : 'We’ll search nearby with these filters'}
          </AppText>
        </View>
      }
    >
      <SectionHeader title="Distance" style={{ marginTop: space.sm }} />
      <Segmented
        options={config.RADIUS_OPTIONS_KM.map((km) => ({ value: km, label: `${km} km` }))}
        value={f.distanceKm}
        onChange={(v) => set({ distanceKm: v })}
      />

      <SectionHeader title="When" />
      <Options label="When" options={WHEN_OPTIONS} value={f.when} onChange={(v) => set({ when: v })} />

      <SectionHeader title="Activities" right={f.categories.length ? <TextAction label="Any" accessibilityLabel="Any activity" onPress={() => set({ categories: [] })} /> : null} />
      <ChipGrid columns={2}>
        {categories.map((c) => (
          <Chip key={c.slug} label={c.short} pictogram={c.pictogram} fill selected={f.categories.includes(c.slug)} onPress={() => toggleCat(c.slug)} />
        ))}
      </ChipGrid>

      {/* More filters (progressive disclosure) */}
      <Pressable
        onPress={() => setMoreOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        accessibilityLabel={`More filters${moreCount ? `, ${moreCount} on` : ''}`}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, marginTop: space.xl, paddingHorizontal: space.md, backgroundColor: colors.surface, borderRadius: radius.card }}
      >
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          More filters
        </AppText>
        {moreCount > 0 && (
          <AppText variant="label" color={colors.muted} style={{ marginRight: space.xs }}>
            {moreCount} on
          </AppText>
        )}
        <Icon name={moreOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {moreOpen && (
        <Animated.View entering={fadeIn()}>
          <SectionHeader title="Group size" style={{ marginTop: space.lg }} />
          <Options label="Group size" options={GROUP_OPTIONS} value={f.groupSize} onChange={(v) => set({ groupSize: v })} />
          <SectionHeader title="Activity level" />
          <Options label="Activity level" options={LEVEL_OPTIONS} value={f.level} onChange={(v) => set({ level: v })} />
          <ListGroup style={{ marginTop: space.xl }}>
            <ListRow icon="info" title="Accessibility info listed" toggle={f.accessible} onToggle={(v) => set({ accessible: v })} />
            <ListRow icon="tag" title="Free plans only" toggle={f.freeOnly} onToggle={(v) => set({ freeOnly: v })} last />
          </ListGroup>
        </Animated.View>
      )}
    </Screen>
  );
}
