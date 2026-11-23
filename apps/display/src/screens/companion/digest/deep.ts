/**
 * Deep links (v4 D): `/app#chores/chore-1` opens the Chores tab, and this finds the chore on
 * the page, scrolls to it and makes it glow. Items opt in with `data-deep="<id>"`; the page
 * may still be loading, so it looks again for a few seconds.
 */
import { useEffect } from 'react';
import '../../../features/digest/digest.css';

/** Find `[data-deep=id]` and bring it into view. True when found. */
export function focusDeep(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-deep="${CSS.escape(id)}"]`);
  if (!el) return false;
  // A `display: contents` wrapper has no box; use its first child.
  const target =
    el.getClientRects().length === 0 && el.firstElementChild instanceof HTMLElement
      ? el.firstElementChild
      : el;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('deep-flash');
  void target.offsetWidth;
  target.classList.add('deep-flash');
  setTimeout(() => target.classList.remove('deep-flash'), 2200);
  return true;
}

/** When `id` is set, keep looking for it (data arrives after the tab mounts), up to 4 s. */
export function useDeepFocus(id: string | undefined) {
  useEffect(() => {
    if (!id) return;
    let tries = 0;
    const t = setInterval(() => {
      if (focusDeep(id) || ++tries > 20) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, [id]);
}
