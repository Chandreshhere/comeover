// Coach-mark target registry for the app tour.
//
// Wrap anything the tour should point at:
//   <TourTarget id="discover:search"> … </TourTarget>
// The tour measures targets on demand (measureInWindow), so positions are
// always fresh — after layout changes, scrolling or rotation. Targets that
// re-layout notify subscribers so an open step can re-measure.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';

const targets = new Map(); // id -> ref
const subscribers = new Set();

const emit = (id) => subscribers.forEach((fn) => fn(id));

export function registerTarget(id, ref) {
  targets.set(id, ref);
  emit(id);
  return () => {
    if (targets.get(id) === ref) {
      targets.delete(id);
      emit(id);
    }
  };
}

export const hasTarget = (id) => !!targets.get(id)?.current;

export function subscribeTargets(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Resolves { x, y, width, height } in window coordinates, or null.
export function measureTarget(id) {
  const ref = targets.get(id);
  const node = ref?.current;
  if (!node || typeof node.measureInWindow !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const t = setTimeout(() => done(null), 600);
    try {
      node.measureInWindow((x, y, width, height) => {
        clearTimeout(t);
        done(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch (e) {
      clearTimeout(t);
      done(null);
    }
  });
}

export default function TourTarget({ id, children, style, ...rest }) {
  const ref = useRef(null);
  useEffect(() => registerTarget(id, ref), [id]);
  return (
    // collapsable={false}: keep a real native view so it can be measured.
    <View ref={ref} collapsable={false} style={style} onLayout={() => emit(id)} {...rest}>
      {children}
    </View>
  );
}
