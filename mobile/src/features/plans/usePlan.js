import { Alert } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useAppStore } from '@/store/useAppStore';
import useLoader from '@/hooks/useLoader';

// Resolves the activity for the current route (`params.id`), keeps it fresh
// from GET /activities/{id} on focus, and exposes my join state.
export default function usePlan({ load = true } = {}) {
  const route = useRoute();
  const id = route.params?.id;
  const activity = useAppStore((s) => s.activities.find((a) => a.id === id));
  const joinState = useAppStore((s) => s.joinStates[id]);
  const loader = useLoader(`activity:${id}`, (s) => (load && id ? s.loadActivity(id) : null), [id, load]);
  const isHost = activity?.host?.id === 'me';
  return { id, activity, joinState, isHost, params: route.params || {}, loader };
}

// The group chat id comes from the server (activity.conversationId) or the
// conversations list. If neither is known yet, refresh conversations once.
export async function openGroupChat(nav, activity) {
  if (!activity) return;
  const s = useAppStore.getState();
  let cid = activity.conversationId || s.conversations.find((c) => c.activityId === activity.id)?.id;
  if (!cid) {
    try {
      const list = await s.loadConversations({ silent: true });
      cid = (list || []).find((c) => c.activityId === activity.id)?.id;
    } catch (e) {
      Alert.alert('Chat unavailable', e?.code === 'network' || e?.code === 'timeout' ? 'No connection. Try again in a moment.' : e?.message || 'Please try again.');
      return;
    }
  }
  if (cid) nav.navigate('group_chat', { conversationId: cid });
  else Alert.alert('Chat not open yet', 'The group chat opens for everyone once the host has accepted them. Try again in a moment.');
}
