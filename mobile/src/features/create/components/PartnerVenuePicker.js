// Create step 3: "Partner places nearby". Verified partner venues (GET /venues,
// nearest first, ones with perks on top) the host can pick. Picking one sets
// venueId + name + area; tapping it again clears it. Typing a free-text venue
// name still works. Hidden while loading, when empty, or on any error.
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Icon, IconBubble, Tag } from '@/components';
import { colors, space } from '@/theme/tokens';
import { coarseDistance } from '@/utils/format';
import haptics from '@/utils/haptics';
import { useAppStore } from '@/store/useAppStore';
import useRemote from '@/features/premium/useRemote';
import { fetchVenues, nearParams } from '@/features/business/businessShared';
import { venueTone } from '@/features/business/components/VenueCard';
import { FieldLabel } from './StepScaffold';

const MAX = 5;

function VenueOption({ venue: v, selected, onPress }) {
  const meta = [v.kind, v.area, v.distanceM != null ? `~${coarseDistance(v.distanceM)}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${v.name}${meta ? `, ${meta}` : ''}${v.bestOfferLabel ? `. Perk: ${v.bestOfferLabel}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        padding: space.sm,
        borderRadius: 20,
        backgroundColor: colors.surface,
        borderWidth: selected ? 2 : 1.2,
        borderColor: selected ? colors.ink : colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <IconBubble size={44} tone={venueTone(v)} pictogram={v.pictogram} iconSize={24} />
      <View style={{ flex: 1, marginHorizontal: space.sm }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {v.name}
        </AppText>
        {!!meta && (
          <AppText variant="caption" color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>
            {meta}
          </AppText>
        )}
        {!!v.bestOfferLabel && <Tag label={v.bestOfferLabel} icon="ticket" bg={colors.orangeSoft} fg={colors.ink} style={{ marginTop: space.xxs }} />}
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: selected ? colors.ink : colors.border,
          backgroundColor: selected ? colors.ink : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && <Icon name="check" size={14} color={colors.white} />}
      </View>
    </Pressable>
  );
}

export default function PartnerVenuePicker({ selectedId, selectedName, onPick }) {
  const coords = useAppStore((s) => s.prefs.coords);
  const homeArea = useAppStore((s) => s.profile.area);
  const lat = coords?.latitude;
  const lng = coords?.longitude;
  const q = useRemote(() => fetchVenues(null, { near: nearParams(lat != null ? { latitude: lat, longitude: lng } : null, homeArea), limit: 20 }), [lat, lng, homeArea], {
    refetchOnFocus: false,
  });

  const venues = useMemo(() => {
    const list = (q.data || []).filter((v) => v.verified !== false);
    // Venues with perks first; the API order (nearest) is kept within each group.
    const ranked = [...list.filter((v) => v.hasOffer), ...list.filter((v) => !v.hasOffer)].slice(0, MAX);
    // Keep a preselected venue (from "Host a plan here") visible even if it isn't nearby.
    if (selectedId && !ranked.some((v) => v.id === selectedId)) {
      const known = list.find((v) => v.id === selectedId) || { id: selectedId, name: selectedName || 'Partner venue', pictogram: 'star', accentIndex: 0 };
      return [known, ...ranked.slice(0, MAX - 1)];
    }
    return ranked;
  }, [q.data, selectedId, selectedName]);

  if (q.status !== 'ready' || !venues.length) return null;

  return (
    <View>
      <FieldLabel right="Optional">Partner places nearby</FieldLabel>
      <View style={{ gap: space.xs }}>
        {venues.map((v) => (
          <VenueOption key={v.id} venue={v} selected={v.id === selectedId} onPress={() => onPick(v.id === selectedId ? null : v)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
        <Icon name="info" size={13} color={colors.muted} />
        <AppText variant="caption" color={colors.muted} style={{ marginLeft: space.xxs, flex: 1 }}>
          Partner venues can hold a table for your group.
        </AppText>
      </View>
    </View>
  );
}
