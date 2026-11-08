// safety_intro — public meetups, consent, block/report and safety rules.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Pictogram } from '@/components';
import { colors, radius, space } from '@/theme/tokens';
import OnboardingFrame, { CheckRow, PointRow } from './components/OnboardingFrame';

const RULES = [
  { icon: 'map-pin', title: 'Public places by default', body: 'Cafés, parks, courts, libraries. Never a private address for a first meetup.', bubble: colors.periwinkleWash },
  { icon: 'user-check', title: 'Hosts approve who joins', body: 'Every plan shows the host, their show-up record and who else is going.', bubble: colors.mint },
  { icon: 'message-circle', title: 'Chat opens after you’re accepted', body: 'No cold DMs. Group chats are tied to a plan.', bubble: colors.lavender },
  { icon: 'flag', title: 'Report or block in one tap', body: 'From any profile, plan or message. Reports are reviewed by people.', bubble: colors.pinkSoft },
  { icon: 'share-2', title: 'Share your plan', body: 'Send plan details to a trusted contact before you go.', bubble: colors.orangeSoft },
  { icon: 'heart', title: 'Consent & boundaries', body: 'Platonic plans only. Leave any time; no one is owed your company.', bubble: colors.periwinkleWash },
];

export default function SafetyIntroScreen() {
  const nav = useNavigation();
  const [agree, setAgree] = useState(false);

  return (
    <OnboardingFrame
      stepId="safety_intro"
      hero={
        <View style={{ backgroundColor: colors.ink, borderRadius: radius.hero, padding: space.lg, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.periwinkle, alignItems: 'center', justifyContent: 'center' }}>
            <Pictogram name="shield" size={34} />
          </View>
          <View style={{ flex: 1, marginLeft: space.md }}>
            <AppText variant="h3" color={colors.white}>
              Safe by default
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.72)">
              Safety tools are free for everyone, always.
            </AppText>
          </View>
        </View>
      }
      title="How we meet IRL"
      subtitle="A few ground rules so every plan feels comfortable."
      footer={<Button title="I'm in" onPress={() => nav.navigate('first_plan_prompt')} disabled={!agree} />}
    >
      {RULES.map((r) => (
        <PointRow key={r.title} icon={r.icon} title={r.title} body={r.body} bubble={r.bubble} />
      ))}
      <CheckRow
        style={{ marginTop: space.md }}
        checked={agree}
        onToggle={() => setAgree((v) => !v)}
        label="I'll meet in public places and follow the community guidelines"
        sublabel="Breaking them can limit or remove your account."
      />
    </OnboardingFrame>
  );
}
