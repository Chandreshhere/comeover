// location_permission — OS permission states: checking, ask, granted, denied,
// blocked (settings), unavailable. Progress is never blocked.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { PERMISSIONS, RESULTS, check, openSettings, request } from 'react-native-permissions';
import { useNavigation } from '@react-navigation/native';
import { GpsSlash } from 'phosphor-react-native/src/icons/GpsSlash';
import { MapPinArea } from 'phosphor-react-native/src/icons/MapPinArea';
import { AppText, Button } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { getCoarsePosition } from '@/services/location';
import { colors, radius, space } from '@/theme/tokens';
import IconBubble, { toneOf } from '@/features/system/IconBubble';
import OnboardingFrame from './components/OnboardingFrame';
import AreaPickerSheet from './components/AreaPickerSheet';

const PERM = Platform.select({
  ios: PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
  android: PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
});

// Each permission state is one short title + one line. Bubble tones are names
// (resolved at render), so the copy table holds no colours.
const COPY = {
  checking: { icon: null, tone: 'neutral', title: 'Checking…', body: 'One moment.' },
  ask: { icon: 'navigation', tone: 'periwinkle', title: 'Allow location?', body: 'Choose "While using the app". That\'s all we need.' },
  granted: { icon: 'check-circle', tone: 'mint', title: 'Location is on', body: 'Others only ever see your area.' },
  denied: { icon: GpsSlash, tone: 'pink', title: 'No problem', body: 'Pick your area by hand. You can turn location on later.' },
  blocked: { icon: 'settings', tone: 'orange', title: 'Location is off', body: 'Turn it on in Settings, or pick your area by hand.' },
  unavailable: { icon: GpsSlash, tone: 'neutral', title: 'Location unavailable', body: 'Pick your area by hand instead.' },
};

export default function LocationPermissionScreen() {
  const nav = useNavigation();
  const area = useAppStore((s) => s.profile.area);
  const setPrefs = useAppStore((s) => s.setPrefs);

  const [state, setState] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [locating, setLocating] = useState(false);
  const askedRef = useRef(false);

  const fromResult = (r) =>
    r === RESULTS.GRANTED || r === RESULTS.LIMITED ? 'granted' : r === RESULTS.BLOCKED ? 'blocked' : r === RESULTS.UNAVAILABLE ? 'unavailable' : 'ask';

  // Coarse (~1 km) fix kept on the device; discovery queries send it rounded.
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const coords = await getCoarsePosition({ timeout: 10000 });
      // Granted but no fix (indoors/airplane) is still fine — area is the fallback.
      setPrefs(coords ? { location: 'granted', coords } : { location: 'granted' });
    } finally {
      setLocating(false);
    }
  }, [setPrefs]);

  const refresh = useCallback(async () => {
    if (!PERM) {
      setState('unavailable');
      return;
    }
    try {
      const r = await check(PERM);
      let s = fromResult(r);
      // After a refusal, Android still reports DENIED (askable) — show it as denied.
      if (s === 'ask' && askedRef.current) s = 'denied';
      setState(s);
      if (s === 'granted') locate();
    } catch (e) {
      setState('unavailable');
    }
  }, [locate]);

  useEffect(() => {
    refresh();
    // Returning from Settings re-checks the permission.
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const ask = async () => {
    askedRef.current = true;
    setBusy(true);
    try {
      const r = await request(PERM);
      const s = fromResult(r);
      const final = s === 'ask' ? 'denied' : s;
      setState(final);
      if (final === 'granted') locate();
      else setPrefs({ location: 'denied' });
    } catch (e) {
      setState('unavailable');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (state !== 'granted' && useAppStore.getState().prefs.location === 'unknown') setPrefs({ location: 'denied' });
    nav.navigate('notification_opt_in');
  };

  const c = COPY[state];

  // One primary action per state, at most one quiet secondary. Picking an area
  // by hand is always available from the "Your area" row.
  let footer;
  if (state === 'granted') {
    footer = <Button title="Continue" onPress={next} loading={locating} />;
  } else if (state === 'ask') {
    footer = (
      <View>
        <Button title="Allow location" icon="navigation" onPress={ask} loading={busy} />
        <Button title="Not now" variant="ghost" style={{ marginTop: space.xs }} onPress={next} />
      </View>
    );
  } else if (state === 'blocked') {
    footer = (
      <View>
        <Button title="Open Settings" icon="settings" onPress={() => openSettings().catch(() => {})} />
        <Button title="Continue without it" variant="ghost" style={{ marginTop: space.xs }} onPress={next} />
      </View>
    );
  } else {
    footer = (
      <View>
        <Button title="Continue" onPress={next} disabled={state === 'checking'} />
        {state === 'denied' && <Button title="Try again" variant="ghost" style={{ marginTop: space.xs }} onPress={ask} />}
      </View>
    );
  }

  return (
    <OnboardingFrame
      stepId="location_permission"
      hero={
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: 160, backgroundColor: colors.surface, borderRadius: radius.hero, alignItems: 'center', justifyContent: 'center' }}
        >
          {c.icon ? (
            <IconBubble icon={c.icon} tone={c.tone} size={88} iconSize={42} />
          ) : (
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: toneOf(c.tone).bg, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.ink} />
            </View>
          )}
        </View>
      }
      title={c.title}
      subtitle={c.body}
      footer={footer}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.xs }}
      >
        <IconBubble icon={MapPinArea} tone="lavender" size={40} iconSize={20} />
        <View style={{ flex: 1, marginHorizontal: space.sm }}>
          <AppText variant="caption" color={colors.muted}>
            Your area
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {area || (locating ? 'Finding your area…' : 'Not set yet')}
          </AppText>
        </View>
        <Button title={area ? 'Change' : 'Choose'} size="sm" variant="ghost" full={false} onPress={() => setPicker(true)} accessibilityLabel={area ? 'Change your area' : 'Choose your area'} />
      </View>

      <AreaPickerSheet
        visible={picker}
        value={area}
        onClose={() => setPicker(false)}
        onSelect={(a, city) => {
          useAppStore.getState().setHomeArea(a, city);
          if (state !== 'granted') setPrefs({ location: 'manual', coords: null });
          setPicker(false);
          if (state !== 'granted') nav.navigate('notification_opt_in');
        }}
      />
    </OnboardingFrame>
  );
}
