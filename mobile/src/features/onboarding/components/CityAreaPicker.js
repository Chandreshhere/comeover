// City + area chooser used by every "your area" sheet. Shows the areas of the
// current city; "Change" swaps to the list of cities Come Over covers.
// onSelect(areaName, city) where city is { name, center, areas } (or the
// current city when the list could not load).
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Chip, ChipGrid, Icon } from '@/components';
import { CITY, CITY_CENTER, areaCentroids } from '@/data/catalog';
import { cachedCities, loadCities } from '@/data/cities';
import { colors, layout, radius, space } from '@/theme/tokens';

// The city the app is showing right now, in the GET /cities shape.
const currentCity = () => ({
  name: CITY.name,
  center: { lat: CITY_CENTER.latitude, lng: CITY_CENTER.longitude },
  areas: CITY.areas.map((name) => ({ name, lat: areaCentroids[name]?.latitude ?? null, lng: areaCentroids[name]?.longitude ?? null })),
});

export default function CityAreaPicker({ value, cityName, onSelect }) {
  const [list, setList] = useState(cachedCities());
  const [chosen, setChosen] = useState(cityName || CITY.name);
  const [choosingCity, setChoosingCity] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCities().then((items) => alive && items.length && setList(items));
    return () => {
      alive = false;
    };
  }, []);

  const city = useMemo(() => list.find((c) => c.name === chosen) || (chosen === CITY.name ? currentCity() : list[0] || currentCity()), [list, chosen]);
  const canSwitch = list.length > 1;

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: layout.minTouch,
          paddingHorizontal: space.sm,
          borderRadius: radius.quest,
          backgroundColor: colors.surfaceSubtle,
          marginBottom: space.sm,
        }}
      >
        <Icon name="map-pin" size={18} color={colors.ink} />
        <View style={{ flex: 1, marginLeft: space.xs }}>
          <AppText variant="caption" color={colors.muted}>
            City
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {choosingCity ? 'Choose your city' : city.name}
          </AppText>
        </View>
        {canSwitch && (
          <Pressable onPress={() => setChoosingCity((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={choosingCity ? 'Back to areas' : 'Change city'} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: space.xs, paddingLeft: space.sm })}>
            <AppText variant="label" color={colors.deep}>
              {choosingCity ? 'Cancel' : 'Change'}
            </AppText>
          </Pressable>
        )}
      </View>

      {choosingCity ? (
        <ChipGrid columns={2}>
          {list.map((c) => (
            <Chip
              key={c.name}
              label={c.name}
              fill
              selected={c.name === city.name}
              onPress={() => {
                setChosen(c.name);
                setChoosingCity(false);
              }}
            />
          ))}
        </ChipGrid>
      ) : (
        <ChipGrid columns={2}>
          {city.areas.map((a) => (
            <Chip key={`${city.name}-${a.name}`} label={a.name} fill selected={value === a.name && city.name === (cityName || CITY.name)} onPress={() => onSelect(a.name, city)} />
          ))}
        </ChipGrid>
      )}
    </View>
  );
}
