import { useEffect } from 'react';

export interface ShortcutOptions {
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** run even when focus is in an input/textarea */
  allowInInputs?: boolean;
  enabled?: boolean;
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useKeyboardShortcut(key: string, handler: (e: KeyboardEvent) => void, opts: ShortcutOptions = {}) {
  const { ctrlOrMeta = false, shift = false, alt = false, allowInInputs = false, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (ctrlOrMeta !== (e.ctrlKey || e.metaKey)) return;
      if (shift !== e.shiftKey) return;
      if (alt !== e.altKey) return;
      if (!allowInInputs && isEditable(e.target)) return;
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, ctrlOrMeta, shift, alt, allowInInputs, enabled]);
}
