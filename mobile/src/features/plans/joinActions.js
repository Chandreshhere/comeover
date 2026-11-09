// Join helpers shared by cards (discover, live, map, assistant) and plan screens.
// The server decides capacity, age gating and blocks; these map its error codes
// to friendly UI and never fake a successful join.
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '@/store/useAppStore';
import useQuickJoin from '@/hooks/useQuickJoin';

const OFFLINE = ['network', 'timeout'];

export function joinErrorCopy(e) {
  const code = e?.code;
  if (code === 'capacity_full') return { title: 'This plan just filled up', body: 'You can join the waitlist, if a spot opens, the host can let you in.' };
  if (code === 'age_gate_required') return { title: 'Confirm you’re 18+', body: 'Come Over is for adults only. Confirm your age to join plans.' };
  if (code === 'account_restricted') return { title: 'Joining is paused', body: 'Your account is limited while a report is reviewed. Safety tools still work, and you can appeal from Settings.' };
  if (code === 'blocked' || code === 'not_allowed' || code === 'forbidden' || code === 'http_403') return { title: 'You can’t join this plan', body: e?.message || 'The host’s settings don’t allow this request.' };
  if (code === 'activity_cancelled' || code === 'activity_ended' || code === 'http_404' || code === 'not_found') return { title: 'Plan no longer available', body: 'It was cancelled or has ended.' };
  if (code === 'already_requested') return { title: 'Request already sent', body: 'The host will decide soon.' };
  if (OFFLINE.includes(code)) return { title: 'No connection', body: 'Check your internet and try again.' };
  return { title: 'Couldn’t send your request', body: e?.message || 'Please try again.' };
}

export function handleJoinError(e, nav, activityId) {
  if (e?.code === 'age_gate_required') {
    nav.navigate('age_gate', { returnTo: { screen: 'activity_detail', params: { id: activityId } } });
    return;
  }
  const c = joinErrorCopy(e);
  const buttons = [{ text: 'OK', style: 'cancel' }];
  if (e?.code === 'capacity_full') buttons.push({ text: 'Waitlist', onPress: () => nav.navigate('waitlist', { id: activityId }) });
  Alert.alert(c.title, c.body, buttons);
}

// Card-level join: approval plans go through the request screen (optional
// intro); instant plans join directly; already-involved users go to the plan.
export default function useJoinAction() {
  const nav = useNavigation();
  const quickJoin = useQuickJoin();
  return useCallback(
    async (a) => {
      const st = useAppStore.getState().joinStates[a.id];
      const fresh = !st || st === 'cancelled' || st === 'declined';
      if (!fresh) {
        nav.navigate(st === 'requested' ? 'join_pending' : st === 'waitlisted' ? 'waitlist' : 'activity_detail', { id: a.id });
        return st;
      }
      if (a.joinRule === 'approval') {
        nav.navigate('join_request', { id: a.id });
        return null;
      }
      try {
        const r = await quickJoin(a);
        if (r === 'waitlisted') nav.navigate('waitlist', { id: a.id });
        return r;
      } catch (e) {
        handleJoinError(e, nav, a.id);
        return null;
      }
    },
    [nav, quickJoin]
  );
}
