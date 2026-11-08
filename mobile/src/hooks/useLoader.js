import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAppStore } from '@/store/useAppStore';

// Runs a store loader whenever the screen gains focus and exposes its status.
//   const feed = useLoader('feed', (s) => s.loadFeed());
//   feed.status: 'idle'|'loading'|'ready'|'error'; feed.error; feed.reload(); feed.refreshing
// `key` must match the key the store action uses for status bookkeeping.
export default function useLoader(key, call, deps = []) {
  const status = useAppStore((s) => s.status[key] || 'idle');
  const error = useAppStore((s) => s.errors[key] || null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    const p = call(useAppStore.getState());
    return p && p.catch ? p.catch(() => null) : p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { status, error, reload, refreshing, loading: status === 'loading' || status === 'idle' };
}
