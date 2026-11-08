// location_permission — OS permission states: checking, ask, granted, denied,
// blocked (settings), unavailable. Progress is never blocked.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { PERMISSIONS, RESULTS, check, openSettings, request } from 'react-native-permissions';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { getCoarsePosition } from '@/services/location';
import { colors, radius, space } from '@/theme/tokens';
import OnboardingFrame from './components/OnboardingFrame';
import AreaPickerSheet from './components/AreaPickerSheet';

const PERM = Platform.select({
  ios: PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
  android: PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
});

const COPY = {
  checking: { icon: 'loader', tone: colors.surfaceSubtle, title: 'Checking permission…', body: '' },
  ask: { icon: 'navigation', tone: colors.periwinkleWash, title: 'Allow location while using the app', body: "Your phone will ask next. Choose \"While using the app\" — that's all we need." },
  granted: { icon: 'check', tone: colors.mint, title: 'Location is on', body: 'We’ll show plans around you. Others only ever see your area.' },
  denied: { icon: 'x', tone: colors.pinkSoft, title: 'Location not allowed', body: 'No problem — pick your area by hand. You can enable it later in Settings.' },
  blocked: { icon: 'settings', tone: colors.orangeSoft, title: 'Location is turned off in Settings', body: 'Enable it in your phone settings, or just choose your area manually.' },
  unavailable: { icon: 'map', tone: colors.surfaceSubtle, title: 'Location unavailable on this device', body: 'Choose your area manually instead.' },
};

export default function LocationPermissionScreen() {
  const nav = useNavigation();
  const area = useAppStore((s) => s.profile.area);
  const setProfile = useAppStore((s) => s.setProfile);
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

  let footer;
  if (state === 'granted') {
    footer = <Button title="Continue" onPress={next} loading={locating} />;
  } else if (state === 'ask') {
    footer = (
      <View>
        <Button title="Allow location" icon="navigation" onPress={ask} loading={busy} />
        <Button title="Skip for now" variant="ghost" style={{ marginTop: space.xs }} onPress={next} />
      </View>
    );
  } else if (state === 'blocked') {
    footer = (
      <View>
        <Button title="Open Settings" icon="settings" onPress={() => openSettings().catch(() => {})} />
        <Button title="Choose area manually" variant="secondary" style={{ marginTop: space.xs }} onPress={() => setPicker(true)} />
      </View>
    );
  } else {
    footer = (
      <View>
        <Button title="Choose area manually" onPress={() => setPicker(true)} disabled={state === 'checking'} />
        {state === 'denied' && <Button title="Try again" variant="ghost" style={{ marginTop: space.xs }} onPress={ask} />}
        {state !== 'checking' && <Button title="Skip for now" variant="ghost" style={{ marginTop: space.xs }} onPress={next} />}
      </View>
    );
  }

  return (
    <OnboardingFrame stepId="location_permission" title="Location" subtitle="Approximate location, only while the app is open." footer={footer}>
      <View
        accessibilityLiveRegion="polite"
        style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, alignItems: 'center' }}
      >
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.tone, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={c.icon} size={34} color={colors.ink} />
        </View>
        <AppText variant="h2" align="center" style={{ marginTop: space.md }}>
          {c.title}
        </AppText>
        {!!c.body && (
          <AppText color={colors.muted} align="center" style={{ marginTop: space.xs }}>
            {c.body}
          </AppText>
        )}
        {state === 'granted' && locating && (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>
            Finding your area…
          </AppText>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.quest, padding: space.md }}>
        <Icon name="map-pin" size={16} />
        <AppText variant="label" style={{ flex: 1, marginLeft: space.xs }}>
          Your area: {area || 'not set'}
        </AppText>
        <AppText variant="label" color={colors.deep} onPress={() => setPicker(true)} accessibilityRole="button" suppressHighlighting>
          Change
        </AppText>
      </View>

      <AreaPickerSheet
        visible={picker}
        value={area}
        onClose={() => setPicker(false)}
        onSelect={(a) => {
          setProfile({ area: a });
          if (state !== 'granted') setPrefs({ location: 'manual', coords: null });
          setPicker(false);
          if (state !== 'granted') nav.navigate('notification_opt_in');
        }}
      />
    </OnboardingFrame>
  );
}
