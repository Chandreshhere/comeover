// safety_intro — public meetups, approval, block/report and boundaries, then
// one agreement. Sharing a plan with a trusted contact lives on each plan and
// in the Safety center.
import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { HandHeart } from 'phosphor-react-native/src/icons/HandHeart';
import { Button } from '@/components';
import { space } from '@/theme/tokens';
import OnboardingFrame, { CheckRow, PointRow } from './components/OnboardingFrame';

// Tones are palette names resolved at render, so dark mode applies.
const RULES = [
  { icon: 'map-pin', title: 'Public places first', body: 'Cafés, parks, courts. Never a home address.', tone: 'periwinkle' },
  { icon: 'user-check', title: 'Hosts approve who joins', body: 'Chat opens only after you’re accepted.', tone: 'mint' },
  { icon: 'flag', title: 'Report or block in one tap', body: 'Reports are reviewed by people.', tone: 'pink' },
  { icon: HandHeart, title: 'Platonic, with boundaries', body: 'Leave any time. No one is owed your company.', tone: 'lavender' },
];

export default function SafetyIntroScreen() {
  const nav = useNavigation();
  const [agree, setAgree] = useState(false);

  return (
    <OnboardingFrame
      stepId="safety_intro"
      title="Our ground rules"
      subtitle="So every plan feels comfortable. Safety tools are always free."
      footer={<Button title="I'm in" onPress={() => nav.navigate('first_plan_prompt')} disabled={!agree} />}
    >
      {RULES.map((r) => (
        <PointRow key={r.title} icon={r.icon} title={r.title} body={r.body} tone={r.tone} />
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
