// Small fetch hook for feature-local API data that doesn't live in the app
// store (plans, venues, campaigns, analytics). Refetches on screen focus and
// keeps the last good data while reloading.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

export default function useRemote(fetcher, deps = [], { enabled = true, refetchOnFocus = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const load = useCallback(async () => {
    if (!enabled) return null;
    const id = ++seq.current;
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading', error: null }));
    try {
      const data = await fetcher();
      if (alive.current && id === seq.current) setState({ status: 'ready', data, error: null });
      return data;
    } catch (e) {
      if (alive.current && id === seq.current) setState((s) => ({ ...s, status: 'error', error: e?.message || 'Something went wrong', errorObj: e }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useFocusEffect(
    useCallback(() => {
      if (refetchOnFocus || seq.current === 0) load();
    }, [load, refetchOnFocus])
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, [load]);

  return { ...state, reload, refreshing, setData: (data) => setState((s) => ({ ...s, data })) };
}

export const itemsOf = (r) => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
