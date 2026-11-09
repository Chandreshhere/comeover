// social_style — "What are you?" (introvert / ambivert / extrovert), asked once
// right after onboarding and editable from Settings. The answer only re-orders
// people and plans (src/utils/socialMatch.js); nobody is ever hidden.
//
// Route params:
//   mode: 'onboarding' (last onboarding step → home; first_plan_prompt passes it)
//       | 'edit'       (default — from Settings: show current pick, save, go back)
//       | 'prompt'     (an already-onboarded account without a style; opened once over home)
//   then: { name, params } — optional screen to open on top of home afterwards
//         (first_plan_prompt passes create_activity_type here).
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MoonStars } from 'phosphor-react-native/src/icons/MoonStars';
import { CloudSun } from 'phosphor-react-native/src/icons/CloudSun';
import { Sun } from 'phosphor-react-native/src/icons/Sun';
import { Sparkle } from 'phosphor-react-native/src/icons/Sparkle';
import { AppText, Button, Icon } from '@/components';
import { useAppStore } from '@/store/useAppStore';
import { TAB_SCREENS } from '@/navigation/inventory';
import { colors, onInkAlpha, radius, space } from '@/theme/tokens';
import { durations, enter, spring } from '@/theme/motion';
import { SOCIAL_STYLES, STYLE_META } from '@/utils/socialMatch';
import haptics from '@/utils/haptics';
import sfx from '@/services/sfx';
import OnboardingFrame from './components/OnboardingFrame';

const ONBOARDING_STEP = 11;

const GLYPHS = { introvert: MoonStars, ambivert: CloudSun, extrovert: Sun };

// Read at render time: pastels flip to deep tones in dark mode.
const tones = () => ({
  introvert: { bubble: colors.lavender, accent: colors.deep },
  ambivert: { bubble: colors.mint, accent: colors.deep },
  extrovert: { bubble: colors.orangeSoft, accent: colors.orange },
});

// What changes once you pick (plain words, mirrors the matching rules).
const EFFECT = {
  introvert: 'Fellow introverts and ambiverts show up first, and small, calm plans get a nudge up.',
  ambivert: 'Ambiverts show up first, then everyone else, and mid-size plans get a nudge up.',
  extrovert: 'Fellow extroverts and ambiverts show up first, and bigger, livelier plans get a nudge up.',
};

function StyleCard({ id, selected, onPress, index }) {
  const meta = STYLE_META[id];
  const tone = tones()[id];
  const Glyph = GLYPHS[id];
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const tilt = useSharedValue(0);

  useEffect(() => {
    if (!selected || reduce) return;
    scale.value = withSequence(withTiming(0.97, { duration: durations.micro }), withSpring(1.02, spring), withSpring(1, spring));
    tilt.value = withSequence(withTiming(-10, { duration: durations.micro }), withSpring(0, { ...spring, damping: 6 }));
  }, [selected, reduce, scale, tilt]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glyphStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));

  return (
    <Animated.View entering={enter(index + 3)} style={[{ marginBottom: space.sm }, cardStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, selected }}
        accessibilityLabel={`${meta.label}. ${meta.blurb}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 96,
          paddingVertical: space.md,
          paddingHorizontal: space.md,
          borderRadius: radius.card,
          backgroundColor: selected ? colors.ink : colors.surface,
          borderWidth: 1.5,
          borderColor: selected ? colors.ink : colors.border,
        }}
      >
        <Animated.View
          style={[
            { width: 60, height: 60, borderRadius: 30, backgroundColor: tone.bubble, alignItems: 'center', justifyContent: 'center' },
            glyphStyle,
          ]}
        >
          <Glyph size={32} color={colors.ink} weight="duotone" duotoneColor={tone.accent} duotoneOpacity={0.55} />
        </Animated.View>
        <View style={{ flex: 1, marginLeft: space.md, marginRight: space.sm }}>
          <AppText variant="h2" color={selected ? colors.white : colors.ink}>
            {meta.label}
          </AppText>
          <AppText variant="body" color={selected ? onInkAlpha(0.75) : colors.inkSoft} style={{ marginTop: 2 }}>
            {meta.blurb}
          </AppText>
        </View>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            borderWidth: 2,
            borderColor: selected ? colors.white : colors.border,
            backgroundColor: selected ? colors.white : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected && (
            <Animated.View entering={ZoomIn.springify().damping(12).reduceMotion(ReduceMotion.System)}>
              <Icon name="check" size={16} color={colors.ink} />
            </Animated.View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function SocialStyleScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const mode = route.params?.mode || 'edit';
  const then = route.params?.then || null;
  const current = useAppStore((s) => s.profile.socialStyle);
  const setProfile = useAppStore((s) => s.setProfile);
  const [pick, setPick] = useState(current || null);

  // Asked once: however the screen is left (continue, skip, back), don't prompt this
  // account again on this device. (Quitting the app mid-onboarding still asks again.)
  useEffect(
    () => () => {
      if (!useAppStore.getState().prefs.socialStyleAsked) useAppStore.getState().setPrefs({ socialStyleAsked: true });
    },
    []
  );

  // Shown as the one-time prompt: don't ask again, whatever they choose.
  useEffect(() => {
    if (mode === 'prompt') useAppStore.getState().setPrefs({ socialStyleAsked: true });
  }, [mode]);

  // Onboarding is a one-way door; edits and the one-off prompt can be swiped away.
  useLayoutEffect(() => {
    nav.setOptions({ gestureEnabled: mode !== 'onboarding' });
  }, [nav, mode]);

  const leave = () => {
    if (mode === 'onboarding') {
      const routes = [{ name: 'main' }, ...(then?.name ? [{ name: then.name, params: then.params }] : [])];
      nav.reset({ index: routes.length - 1, routes });
    } else if (nav.canGoBack()) {
      nav.goBack();
    } else {
      nav.reset({ index: 0, routes: [{ name: 'main' }] });
    }
  };

  const save = () => {
    if (!pick) return;
    haptics.success();
    sfx.play('chime');
    if (pick !== current) setProfile({ socialStyle: pick });
    leave();
  };

  const choose = (id) => {
    haptics.select();
    sfx.play('pop');
    setPick(id);
  };

  const title = mode === 'edit' ? 'Your social energy' : mode === 'prompt' ? 'Quick one: what are you?' : 'What are you?';
  const cta = mode === 'edit' ? 'Save' : 'Continue';

  return (
    <OnboardingFrame
      step={mode === 'onboarding' ? ONBOARDING_STEP : undefined}
      back={mode !== 'onboarding'}
      title={title}
      subtitle="We use this to suggest people and plans you'll click with. You can change it any time in Settings."
      footer={
        <View>
          <Button title={cta} disabled={!pick} onPress={save} accessibilityLabel={pick ? `${cta}: ${STYLE_META[pick].label}` : `Pick one to ${cta.toLowerCase()}`} />
          {mode !== 'edit' && (
            <Button title="Skip for now" variant="ghost" size="sm" onPress={leave} style={{ marginTop: space.xxs }} accessibilityLabel="Skip for now. You can set this later in Settings." />
          )}
        </View>
      }
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Your social energy">
        {SOCIAL_STYLES.map((id, i) => (
          <StyleCard key={id} id={id} index={i} selected={pick === id} onPress={() => choose(id)} />
        ))}
      </View>

      {pick ? (
        <Animated.View
          key={pick}
          entering={FadeIn.duration(durations.standard).reduceMotion(ReduceMotion.System)}
          style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.periwinkleWash, borderRadius: radius.quest, padding: space.md, marginTop: space.xs }}
          accessibilityLiveRegion="polite"
        >
          <View style={{ marginTop: 1 }}>
            <Sparkle size={20} color={colors.ink} weight="duotone" duotoneColor={colors.deep} duotoneOpacity={0.5} />
          </View>
          <View style={{ flex: 1, marginLeft: space.sm }}>
            <AppText variant="bodyStrong">{EFFECT[pick]}</AppText>
            <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xxs }}>
              Nobody is hidden. This only changes the order you see things in.
            </AppText>
          </View>
        </Animated.View>
      ) : (
        <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: space.xs }}>
          Not sure? Ambivert is a fine middle ground.
        </AppText>
      )}
    </OnboardingFrame>
  );
}

// ---------------------------------------------------------------------------
// One-off ask for accounts that finished onboarding before this step existed.
// Watches the navigation container (no changes to RootNavigator/BootSplash):
// once home is showing with fresh server data and no style, open this screen
// over home a single time (prefs.socialStyleAsked is device-local).
const HOME_ROUTES = new Set(['main', ...TAB_SCREENS]);

export function needsSocialStylePrompt(s) {
  return !!(
    s.session.verified &&
    s.session.onboarded &&
    s.status.bootstrap === 'ready' && // only trust this session's /me/bootstrap, not the offline cache
    s.profile.name &&
    !s.profile.socialStyle &&
    !s.prefs.socialStyleAsked
  );
}

let installed = false;
export function installSocialStylePrompt(navRef) {
  if (installed || !navRef) return;
  installed = true;
  let timer = null;
  const check = () => {
    clearTimeout(timer);
    // Let home settle (boot splash reset, first-run tour) before stacking a screen on it.
    timer = setTimeout(() => {
      if (!navRef.isReady()) return;
      const name = navRef.getCurrentRoute()?.name;
      if (!name || !HOME_ROUTES.has(name)) return;
      const s = useAppStore.getState();
      if (!needsSocialStylePrompt(s)) return;
      s.setPrefs({ socialStyleAsked: true });
      navRef.navigate('social_style', { mode: 'prompt' });
    }, 900);
  };
  navRef.addListener('ready', check);
  navRef.addListener('state', check);
}
