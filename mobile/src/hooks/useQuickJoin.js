import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '@/store/useAppStore';

// Quick join used by cards. Enforces the 18+ gate client-side (server enforces
// too) and routes through the full request screen when the host wants an intro.
export default function useQuickJoin() {
  const nav = useNavigation();
  const ageConfirmed = useAppStore((s) => s.session.ageConfirmed);
  const requestJoin = useAppStore((s) => s.requestJoin);
  const blocked = useAppStore((s) => s.blocked);

  return useCallback(
    async (activity) => {
      if (!ageConfirmed) {
        nav.navigate('age_gate', { returnTo: { screen: 'activity_detail', params: { id: activity.id } } });
        return null;
      }
      if (blocked.includes(activity.host?.id)) return null;
      return requestJoin(activity.id);
    },
    [ageConfirmed, blocked, nav, requestJoin]
  );
}
