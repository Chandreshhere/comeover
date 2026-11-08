// Transcribed from 04_motion_system.json. Every animation in the app should use
// these durations / springs so timing stays consistent and reduced-motion aware.
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  ReduceMotion,
} from 'react-native-reanimated';

export const durations = {
  micro: 120,
  standard: 220,
  expressive: 360,
  celebration: 650,
  navTab: 180,
  sheet: 240,
  join: 300,
  streak: 500,
  questComplete: 620,
  roadmapUnlock: 720,
  mascotSuccess: 850,
  radarPulse: 900,
  levelUp: 1100,
  mascotIdle: 2600,
};

export const spring = {
  damping: 16,
  stiffness: 180,
  mass: 0.8,
  reduceMotion: ReduceMotion.System,
};

export const enterOffset = 12;
export const easeOut = Easing.bezier(0.2, 0.8, 0.2, 1);

// Staggered entrance for list/section content. Falls back to an instant state
// change when the OS "Reduce Motion" setting is on.
export const enter = (index = 0) =>
  FadeInDown.duration(durations.standard)
    .delay(Math.min(index, 8) * 50)
    .easing(easeOut)
    .reduceMotion(ReduceMotion.System);

export const fadeIn = (delay = 0) =>
  FadeIn.duration(durations.standard).delay(delay).reduceMotion(ReduceMotion.System);

export const fadeOut = FadeOut.duration(durations.micro).reduceMotion(ReduceMotion.System);
