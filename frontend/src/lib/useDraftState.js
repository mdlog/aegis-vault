import { useCallback, useEffect, useRef, useState } from 'react';

// Persist state to localStorage under a namespaced key so long multi-step
// forms survive reloads. Returns [state, setState, { clearDraft, hasDraft }].
//
// - key: unique per-form string, e.g. 'draft:create-vault:v1'
// - initial: factory or object used on first mount / after clearDraft
// - serialize/deserialize: optional for BigInt / non-JSON types
export function useDraftState(key, initial, { serialize, deserialize, debounceMs = 400 } = {}) {
  const initialValue = typeof initial === 'function' ? initial() : initial;
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initialValue;
      const parsed = deserialize ? deserialize(raw) : JSON.parse(raw);
      return { ...initialValue, ...parsed };
    } catch {
      return initialValue;
    }
  });

  const [hasDraft, setHasDraft] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.localStorage.getItem(key));
  });

  const timerRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const toSave = serialize ? serialize(state) : JSON.stringify(state);
        window.localStorage.setItem(key, toSave);
        setHasDraft(true);
      } catch {
        /* quota / serialization error — ignore */
      }
    }, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [key, state, serialize, debounceMs]);

  // Memoise clearDraft — otherwise a new function is allocated every render,
  // which causes any consumer that lists it in a useEffect dep array to
  // re-fire on every parent render (source of the post-create toast spam).
  // We intentionally omit `initial` from deps: it's typically an inline object
  // that would defeat memoisation, and the factory/object is only meaningful
  // at first mount anyway.
  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch { /* noop */ }
    setState(typeof initial === 'function' ? initial() : initial);
    setHasDraft(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [state, setState, { clearDraft, hasDraft }];
}
