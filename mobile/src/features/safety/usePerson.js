// Reads a member from the store's user cache; if they aren't cached yet,
// fetches GET /users/{id}/public-profile once. Never blocks safety actions:
// callers fall back to "this person" while (or if) the profile can't load.
import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

export default function usePerson(userId) {
  const person = useAppStore((s) => (userId ? s.users[userId] : undefined));
  const status = useAppStore((s) => (userId ? s.status[`user:${userId}`] : undefined));

  useEffect(() => {
    if (!userId || userId === 'me' || person || status === 'loading' || status === 'error') return;
    useAppStore.getState().loadPublicProfile(userId).catch(() => {});
  }, [userId, person, status]);

  return { person: person || null, name: person?.name || 'this person', loading: status === 'loading' };
}
