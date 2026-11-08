// map_discovery — map/list toggle with privacy-safe clustered plan pins.
// Pins are ~1 km cluster centroids of *plans* (server already returns coarse
// coordinates); no person is ever drawn on the map and the device location is
// never shown to others (showsUserLocation off). Zooming re-queries the feed
// with a matching radius (debounced).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityCard,
  AppText,
  Button,
  Card,
  Chip,
  ChipRow,
  ErrorState,
  Icon,
  IconButton,
  Pictogram,
  QueryState,
  Screen,
  Segmented,
} from '@/components';
import { areaCentroids, CITY_CENTER } from '@/data/catalog';
import config from '@/config';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';
import { colors, layout, radius, shadow, space } from '@/theme/tokens';
import useJoinAction from '@/features/plans/joinActions';
import { applyFilters, clusterActivities, countActiveFilters, joinUiState, sortActivities, visibleActivities } from './utils';

const REGION_DEBOUNCE_MS = 700;
const deltaForKm = (km) => Math.min(0.5, Math.max(0.03, (km / 111) * 2.6));
// Inverse of deltaForKm, snapped to the nearest supported radius.
const kmForDelta = (delta) => {
  const km = (delta * 111) / 2.6;
  return config.RADIUS_OPTIONS_KM.reduce((best, r) => (Math.abs(r - km) < Math.abs(best - km) ? r : best), config.RADIUS_OPTIONS_KM[0]);
};

// Soft, low-contrast basemap so pastel pins carry the hierarchy (Google provider only).
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F2F3F8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#767985' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#C8D7FF' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

class MapBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e) {
    // eslint-disable-next-line no-console
    console.warn('[IRL] Map failed to render', e?.message);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ClusterPin({ cluster, selected }) {
  const n = cluster.items.length;
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: selected ? 54 : 46,
          height: selected ? 54 : 46,
          borderRadius: 27,
          backgroundColor: selected ? colors.ink : colors.periwinkle,
          borderWidth: 3,
          borderColor: colors.white,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pictogram name={cluster.pictogram} size={selected ? 26 : 22} color={selected ? colors.white : colors.ink} />
      </View>
      {n > 1 && (
        <View style={{ position: 'absolute', top: -4, right: -6, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.orange, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <AppText variant="caption">{n}</AppText>
        </View>
      )}
    </View>
  );
}

export default function MapDiscoveryScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const activities = useAppStore((s) => s.activities);
  const feedIds = useAppStore((s) => s.feedIds);
  const joinStates = useAppStore((s) => s.joinStates);
  const blocked = useAppStore((s) => s.blocked);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const locationPref = useAppStore((s) => s.prefs.location);
  const coords = useAppStore((s) => s.prefs.coords);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const area = useAppStore((s) => s.profile.area);
  const join = useJoinAction();
  const feed = useLoader('feed', (s) => s.loadFeed());

  const [mode, setMode] = useState('map');
  const [selected, setSelected] = useState(null);
  const [tracks, setTracks] = useState(true);
  const [mapFailed, setMapFailed] = useState(false);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const list = useMemo(() => applyFilters(visibleActivities(feedIds.map((id) => byId.get(id)).filter(Boolean), { blocked }), filters), [feedIds, byId, blocked, filters]);
  const clusters = useMemo(() => clusterActivities(list), [list]);
  const selectedCluster = clusters.find((c) => c.id === selected);
  const filterCount = countActiveFilters(filters);
  const km = filters.distanceKm || config.DEFAULT_RADIUS_KM;
  const delta = deltaForKm(km);
  // Centre on the (rounded) device position when allowed, else the chosen area.
  const center = useMemo(
    () => (locationPref === 'granted' && coords ? coords : areaCentroids[area] || CITY_CENTER),
    [locationPref, coords, area]
  );

  const mapRef = useRef(null);
  const programmatic = useRef(false);
  const regionTimer = useRef(null);
  useEffect(() => {
    programmatic.current = true;
    mapRef.current?.animateToRegion?.({ latitude: center.latitude, longitude: center.longitude, latitudeDelta: delta, longitudeDelta: delta }, 300);
  }, [delta, center]);
  useEffect(() => () => clearTimeout(regionTimer.current), []);

  const setRadius = (r) => {
    if (r === km) return;
    setFilters({ distanceKm: r });
    useAppStore.getState().loadFeed().catch(() => null);
  };

  // Pinch-zoom → re-query with the matching radius (debounced). Panning keeps
  // the server's centre (your coarse position / area) by design.
  const onRegionChangeComplete = (region) => {
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    clearTimeout(regionTimer.current);
    regionTimer.current = setTimeout(() => {
      const next = kmForDelta(region.latitudeDelta);
      if (next !== useAppStore.getState().filters.distanceKm) {
        useAppStore.getState().setFilters({ distanceKm: next });
        useAppStore.getState().loadFeed({ silent: true }).catch(() => null);
      }
    }, REGION_DEBOUNCE_MS);
  };

  // Custom marker views need one render pass with tracking on (Android).
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(t);
  }, [selected, clusters.length]);

  const fallback = (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.canvas }}>
      <ErrorState kind="api" title="Map unavailable" body="The map couldn't load on this device. The list shows the same plans." onRetry={() => setMapFailed(false)} secondary="Show list" onSecondary={() => setMode('list')} />
    </View>
  );

  return (
    <Screen bg={colors.canvas} scroll={false} padded={false}>
      {/* Top controls */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: space.xs, gap: space.xs }}>
        <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => nav.goBack()} />
        <Segmented options={[{ value: 'map', label: 'Map' }, { value: 'list', label: 'List' }]} value={mode} onChange={setMode} style={{ flex: 1 }} />
        <IconButton icon="sliders" variant={filterCount ? 'ink' : 'surface'} badge={filterCount > 0} accessibilityLabel="Filters" onPress={() => nav.navigate('filters_sheet')} />
      </View>
      <View style={{ paddingBottom: space.xs }}>
        <ChipRow>
          {config.RADIUS_OPTIONS_KM.map((r) => (
            <Chip key={r} label={`${r} km`} icon="target" selected={km === r} onPress={() => setRadius(r)} />
          ))}
        </ChipRow>
      </View>

      {locationPref === 'denied' && (
        <Card padding={12} style={{ marginHorizontal: layout.screenPadding, marginBottom: space.xs, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="map-pin" size={18} />
          <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginHorizontal: space.xs }}>
            Location is off — showing plans around {area}. Distances are from your chosen area.
          </AppText>
          <Button title="Keep area" size="xs" full={false} variant="secondary" onPress={() => setPrefs({ location: 'manual' })} />
        </Card>
      )}

      {mode === 'map' ? (
        <View style={{ flex: 1, overflow: 'hidden', borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero }}>
          {mapFailed ? (
            fallback
          ) : (
            <MapBoundary fallback={fallback}>
              <MapView
                style={{ flex: 1 }}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                customMapStyle={Platform.OS === 'android' ? MAP_STYLE : undefined}
                ref={mapRef}
                initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: delta, longitudeDelta: delta }}
                showsUserLocation={false}
                showsPointsOfInterest={false}
                toolbarEnabled={false}
                onRegionChangeComplete={onRegionChangeComplete}
                onPress={() => setSelected(null)}
                onMapReady={() => setMapFailed(false)}
                accessibilityLabel={`Map with ${clusters.length} plan clusters`}
              >
                {clusters.map((c) => (
                  <Marker
                    key={c.id}
                    coordinate={{ latitude: c.latitude, longitude: c.longitude }}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      setSelected(c.id);
                    }}
                    tracksViewChanges={tracks}
                    accessibilityLabel={`${c.items.length} plan${c.items.length > 1 ? 's' : ''} around ${c.area}`}
                  >
                    <ClusterPin cluster={c} selected={selected === c.id} />
                  </Marker>
                ))}
              </MapView>
            </MapBoundary>
          )}

          {/* Legend */}
          <View style={[{ position: 'absolute', top: space.sm, left: space.sm, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center' }, shadow.card]}>
            {feed.status === 'loading' ? <ActivityIndicator size="small" color={colors.deep} /> : <Icon name="shield" size={13} color={colors.success} />}
            <AppText variant="caption" style={{ marginLeft: 6 }}>
              {feed.status === 'loading' && !list.length ? 'Finding plans…' : `${list.length} plans · approximate areas only`}
            </AppText>
          </View>
          {feed.status === 'error' && (
            <View style={[{ position: 'absolute', top: 52, left: space.sm, right: space.sm, backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.sm, flexDirection: 'row', alignItems: 'center' }, shadow.card]}>
              <Icon name="wifi-off" size={15} />
              <AppText variant="caption" style={{ flex: 1, marginLeft: 6 }}>
                {feed.error || 'Couldn’t refresh plans.'}
              </AppText>
              <Button title="Retry" size="xs" full={false} variant="secondary" onPress={feed.reload} />
            </View>
          )}

          {/* Selected cluster carousel */}
          {selectedCluster ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + space.sm }}
              contentContainerStyle={{ paddingHorizontal: layout.screenPadding, gap: space.sm }}
              snapToInterval={Math.min(300, width - 60) + space.sm}
              decelerationRate="fast"
            >
              {selectedCluster.items.map((a, i) => (
                <ActivityCard
                  key={a.id}
                  activity={a}
                  index={i}
                  variant="row"
                  joinState={joinUiState(joinStates[a.id])}
                  onPress={() => nav.navigate('activity_detail', { id: a.id })}
                  onJoin={() => join(a)}
                  style={[{ width: Math.min(300, width - 60) }, shadow.floating]}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={{ position: 'absolute', bottom: insets.bottom + space.md, alignSelf: 'center' }}>
              <View style={[{ backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10 }, shadow.floating]}>
                <AppText variant="label" color={colors.white}>
                  Tap a pin to see plans
                </AppText>
              </View>
            </View>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: insets.bottom + space.xl, gap: space.sm }} showsVerticalScrollIndicator={false}>
          <QueryState
            status={feed.status}
            error={feed.error}
            hasData={list.length > 0}
            onRetry={feed.reload}
            empty={{
              title: 'Nothing in this radius',
              body: 'Widen the distance or clear filters.',
              cta: `Search ${config.RADIUS_OPTIONS_KM[config.RADIUS_OPTIONS_KM.length - 1]} km`,
              onCta: () => setRadius(config.RADIUS_OPTIONS_KM[config.RADIUS_OPTIONS_KM.length - 1]),
              secondary: 'Start a plan',
              onSecondary: () => nav.navigate('create_activity_type'),
            }}
          >
            {sortActivities(list, 'nearest').map((a, i) => (
              <ActivityCard
                key={a.id}
                activity={a}
                index={i}
                variant="row"
                joinState={joinUiState(joinStates[a.id])}
                onPress={() => nav.navigate('activity_detail', { id: a.id })}
                onJoin={() => join(a)}
              />
            ))}
          </QueryState>
        </ScrollView>
      )}
    </Screen>
  );
}
