/**
 * Pointer drag for Arrange mode. The card under the finger follows it (a transform on the
 * slot's `.hm-lift` child, so the slot itself stays in the grid as the live placeholder), and
 * passing over another card moves the slot there. Works inside the scaled panel: distances are measured in
 * screen pixels and divided by the panel's scale.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Movement before a press becomes a drag, so a tap on a card's tools stays a tap. */
const DRAG_SLOP_PX = 6;

interface Press {
  key: string;
  id: number;
  el: HTMLElement;
  /** The part that follows the finger. */
  lift: HTMLElement;
  startX: number;
  startY: number;
  /** Where on the card it was picked up, in screen pixels. */
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  started: boolean;
  lastTarget: string | null;
}

export interface CardDragHandlers {
  /** Drop over another card. */
  onOver: (key: string, targetKey: string) => void;
  /** Drop over the empty part of a column (`true` is the side column). */
  onColumn: (key: string, side: boolean) => void;
}

export function useCardDrag(enabled: boolean, handlers: CardDragHandlers, layoutKey: unknown) {
  const [dragging, setDragging] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const live = useRef(handlers);
  live.current = handlers;

  /** Put the card under the finger again, wherever the layout has moved its place to. */
  const place = useCallback(() => {
    const p = press.current;
    if (!p?.started) return;
    const r = p.el.getBoundingClientRect();
    const scale = p.el.offsetWidth ? r.width / p.el.offsetWidth : 1;
    const tx = (p.x - p.grabX - r.left) / scale;
    const ty = (p.y - p.grabY - r.top) / scale;
    p.lift.style.transform = `translate(${tx}px, ${ty}px)`;
  }, []);

  const hitTest = useCallback((p: Press) => {
    const under = document.elementsFromPoint(p.x, p.y);
    for (const el of under) {
      const slot = (el as HTMLElement).closest?.<HTMLElement>('.hm-slot[data-card]');
      const key = slot?.dataset.card;
      if (slot && key && key !== p.key && !p.el.contains(slot)) {
        if (key !== p.lastTarget) {
          p.lastTarget = key;
          live.current.onOver(p.key, key);
        }
        return;
      }
    }
    p.lastTarget = null;
    for (const el of under) {
      const col = (el as HTMLElement).closest?.('.hm-rooms, .hm-rail');
      if (col) {
        live.current.onColumn(p.key, col.classList.contains('hm-rail'));
        return;
      }
    }
  }, []);

  const end = useCallback(() => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    p.lift.style.transform = '';
    if (p.started) {
      // The click that ends a drag is not a tap on whatever is underneath.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    setDragging(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const move = (ev: PointerEvent) => {
      const p = press.current;
      if (!p || ev.pointerId !== p.id) return;
      p.x = ev.clientX;
      p.y = ev.clientY;
      if (!p.started) {
        if (Math.hypot(p.x - p.startX, p.y - p.startY) < DRAG_SLOP_PX) return;
        p.started = true;
        setDragging(p.key);
      }
      ev.preventDefault();
      place();
      hitTest(p);
    };
    const up = (ev: PointerEvent) => {
      if (press.current && ev.pointerId === press.current.id) end();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      end();
    };
  }, [enabled, place, hitTest, end]);

  // A move re-renders the grid; keep the card under the finger in its new place.
  useLayoutEffect(place, [layoutKey, place]);

  const bind = (key: string) =>
    enabled
      ? {
          onPointerDown: (ev: React.PointerEvent<HTMLElement>) => {
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            // The tools on a card are buttons; pressing one is not a drag.
            if ((ev.target as HTMLElement).closest('button')) return;
            const el = ev.currentTarget;
            const r = el.getBoundingClientRect();
            press.current = {
              key,
              id: ev.pointerId,
              el,
              lift: el.querySelector<HTMLElement>('.hm-lift') ?? el,
              startX: ev.clientX,
              startY: ev.clientY,
              grabX: ev.clientX - r.left,
              grabY: ev.clientY - r.top,
              x: ev.clientX,
              y: ev.clientY,
              started: false,
              lastTarget: null,
            };
          },
        }
      : {};

  return { dragging, bind };
}
