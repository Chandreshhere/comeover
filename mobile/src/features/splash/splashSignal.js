// "Has the cold-start splash finished?" The app boots underneath the splash, so
// anything that talks or animates for the user (the intro guide, the app tour)
// waits for this before starting.
import { useSyncExternalStore } from 'react';

let done = false;
const subscribers = new Set();

export function markSplashDone() {
  if (done) return;
  done = true;
  subscribers.forEach((fn) => fn());
}

export const isSplashDone = () => done;

const subscribe = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

export function useSplashDone() {
  return useSyncExternalStore(subscribe, isSplashDone, isSplashDone);
}
