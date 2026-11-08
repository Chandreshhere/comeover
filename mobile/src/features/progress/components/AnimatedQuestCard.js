// QuestRow + quest_complete motion: card compresses to 0.98, a check draws,
// then the parent fires an XpBurst. Reduce Motion => instant state change.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { QuestRow } from '@/components';
import { colors, radius } from '@/theme/tokens';
import { durations, spring } from '@/theme/motion';
import { useAppStore } from '@/store/useAppStore';
import haptics from '@/utils/haptics';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LEN = 30;

export function questRowProps(q) {
  switch (q.state) {
    case 'completed':
      return { subtitle: 'Done! Tap to claim your XP', xp: q.xp };
    case 'claimed':
      return { subtitle: `Claimed · +${q.xp} XP`, done: true };
    case 'expired':
      return { subtitle: 'Expired — fresh quests arrive tomorrow', locked: true };
    default:
      return { subtitle: q.subtitle, progress: q.progress, total: q.total };
  }
}

export default function AnimatedQuestCard({ quest, tone = 'dark', highlighted = false, onClaimed, onOpen, onError, style }) {
  const reduce = useReducedMotion();
  const claimQuest = useAppStore((s) => s.claimQuest);
  const scale = useSharedValue(1);
  const draw = useSharedValue(0);
  const glow = useSharedValue(0);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!highlighted || reduce) return;
    glow.value = withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0.35, { duration: 600 })), 3, false);
  }, [highlighted, reduce]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: highlighted ? (reduce ? 1 : glow.value) : 0 }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - draw.value) }));

  const onPress = async () => {
    if (quest.state !== 'completed') {
      onOpen?.(quest);
      return;
    }
    if (busy) return;
    setBusy(true);
    setDrawing(true);
    if (!reduce) {
      scale.value = withSequence(withTiming(0.98, { duration: durations.micro }), withSpring(1, spring));
      draw.value = 0;
      draw.value = withTiming(1, { duration: durations.expressive });
    } else {
      draw.value = 1;
    }
    try {
      // Server-authoritative: XP comes from POST /quests/{id}/claim.
      const xp = await claimQuest(quest.id);
      if (xp) haptics.success();
      onClaimed?.(xp, quest);
      setTimeout(() => setDrawing(false), reduce ? 200 : durations.questComplete);
    } catch (e) {
      setDrawing(false);
      draw.value = 0;
      onError?.(e?.message || 'Couldn’t claim that quest. Try again.', quest);
    } finally {
      setBusy(false);
    }
  };

  const p = questRowProps(quest);
  return (
    <View style={style}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderRadius: radius.quest + 3, borderWidth: 2.5, borderColor: colors.deep }, ringStyle]} />
      <Animated.View style={cardStyle}>
        <QuestRow title={quest.title} pictogram={quest.pictogram} tone={tone} onPress={onPress} {...p} />
        {drawing && (
          <View pointerEvents="none" style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <AnimatedPath d="M5 12.5 L10 17.5 L19 7" stroke={colors.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`} animatedProps={checkProps} />
              </Svg>
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}
