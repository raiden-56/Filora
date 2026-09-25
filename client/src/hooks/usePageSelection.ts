import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Selection state for a list of page keys with shift-click range support,
 * select-all / invert / clear, and a stack for undoing selection changes.
 */
export function usePageSelection(keys: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastClicked = useRef<string | null>(null);
  const history = useRef<Set<string>[]>([]);

  const push = useCallback((next: Set<string>) => {
    setSelected((prev) => {
      history.current.push(prev);
      if (history.current.length > 50) history.current.shift();
      return next;
    });
  }, []);

  const toggle = useCallback(
    (key: string, shiftKey = false) => {
      setSelected((prev) => {
        history.current.push(prev);
        const next = new Set(prev);
        if (shiftKey && lastClicked.current && lastClicked.current !== key) {
          const a = keys.indexOf(lastClicked.current);
          const b = keys.indexOf(key);
          if (a >= 0 && b >= 0) {
            const [start, end] = a < b ? [a, b] : [b, a];
            const adding = !prev.has(key);
            for (let i = start; i <= end; i++) {
              if (adding) next.add(keys[i]);
              else next.delete(keys[i]);
            }
            lastClicked.current = key;
            return next;
          }
        }
        if (next.has(key)) next.delete(key);
        else next.add(key);
        lastClicked.current = key;
        return next;
      });
    },
    [keys],
  );

  const selectAll = useCallback(() => push(new Set(keys)), [keys, push]);
  const clear = useCallback(() => push(new Set()), [push]);
  const invert = useCallback(() => {
    setSelected((prev) => {
      history.current.push(prev);
      return new Set(keys.filter((k) => !prev.has(k)));
    });
  }, [keys]);
  const set = useCallback((next: Iterable<string>) => push(new Set(next)), [push]);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) setSelected(prev);
  }, []);
  const selectedList = useMemo(() => keys.filter((k) => selected.has(k)), [keys, selected]);

  return { selected, selectedList, toggle, selectAll, clear, invert, set, undo, canUndo: history.current.length > 0 };
}
