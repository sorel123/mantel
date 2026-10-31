import { AnimatePresence, motion } from 'framer-motion';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EASE, SLOW, STD, motionOr, useMotionPreference } from '../motion';
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog';
import { Popover, type PopoverOptions } from './Popover';
import { Sheet, type SheetOptions } from './Sheet';
import { Toasts, type ToastItem, type ToastOptions } from './Toast';

/** Render function for sheet and pop-over content; call `close` to dismiss. */
export type OverlayRender = (close: () => void) => ReactNode;

export interface OverlayApi {
  /** Slide a sheet in from the right (the Month screen's day sheet, a settings pane). Replaces an open sheet. */
  openSheet(render: OverlayRender, options?: SheetOptions): void;
  closeSheet(): void;
  /** Ask before something that matters (unlock the door). Resolves true when confirmed. */
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** A large card over any screen (doorbell live view). Auto-closes after `durationMs` if given. Returns a closer. */
  showPopover(render: OverlayRender, options?: PopoverOptions): () => void;
  closePopover(): void;
  /** A short message at the bottom; dismisses itself. */
  toast(message: string, options?: ToastOptions): void;
  /** Close everything that blocks the screen (used on navigation and when Ambient starts). */
  closeAll(): void;
  /** True while a sheet, dialog or pop-over is up. */
  blocking: boolean;
}

const Ctx = createContext<OverlayApi | null>(null);

interface SheetState {
  key: number;
  render: OverlayRender;
  options: SheetOptions;
}
interface ConfirmState {
  key: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}
interface PopoverState {
  key: number;
  render: OverlayRender;
  options: PopoverOptions;
}

/**
 * Holds overlay state and renders the overlay layer after its children, so put it directly inside
 * the scaled panel. Screens call `useOverlay()`.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const reduced = useMotionPreference();
  const seq = useRef(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [dialog, setDialog] = useState<ConfirmState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const closePopover = useCallback(() => setPopover(null), []);
  const settleDialog = useCallback((ok: boolean) => {
    setDialog((d) => {
      d?.resolve(ok);
      return null;
    });
  }, []);

  const openSheet = useCallback((render: OverlayRender, options: SheetOptions = {}) => {
    setSheet({ key: ++seq.current, render, options });
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog((prev) => {
          prev?.resolve(false);
          return { key: ++seq.current, options, resolve };
        });
      }),
    [],
  );

  const showPopover = useCallback((render: OverlayRender, options: PopoverOptions = {}) => {
    const key = ++seq.current;
    setPopover({ key, render, options });
    return () => setPopover((p) => (p?.key === key ? null : p));
  }, []);

  const dismissToast = useCallback(
    (key: number) => setToasts((t) => t.filter((x) => x.key !== key)),
    [],
  );
  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const key = ++seq.current;
      setToasts((t) => [...t.slice(-2), { key, message, options }]);
      window.setTimeout(() => dismissToast(key), options.durationMs ?? 3500);
    },
    [dismissToast],
  );

  const closeAll = useCallback(() => {
    setSheet(null);
    setPopover(null);
    settleDialog(false);
  }, [settleDialog]);

  // Pop-over auto-close.
  useEffect(() => {
    if (!popover?.options.durationMs) return;
    const key = popover.key;
    const t = window.setTimeout(
      () => setPopover((p) => (p?.key === key ? null : p)),
      popover.options.durationMs,
    );
    return () => window.clearTimeout(t);
  }, [popover]);

  // Escape closes the topmost blocking overlay (handy with a keyboard in dev).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dialog) settleDialog(false);
      else if (popover) closePopover();
      else if (sheet) closeSheet();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, popover, sheet, settleDialog, closePopover, closeSheet]);

  const blocking = Boolean(sheet || dialog || popover);
  const api = useMemo<OverlayApi>(
    () => ({
      openSheet,
      closeSheet,
      confirm,
      showPopover,
      closePopover,
      toast,
      closeAll,
      blocking,
    }),
    [openSheet, closeSheet, confirm, showPopover, closePopover, toast, closeAll, blocking],
  );

  const onScrim = () => {
    if (dialog) settleDialog(false);
    else if (popover && popover.options.dismissOnScrim !== false) closePopover();
    else if (sheet) closeSheet();
  };
  const showScrim = Boolean(dialog || sheet || (popover && popover.options.scrim !== false));

  return (
    <Ctx.Provider value={api}>
      {children}
      <AnimatePresence>
        {showScrim && (
          <motion.div
            key="scrim"
            className="scrim"
            data-no-swipe
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionOr(reduced, { duration: STD, ease: EASE })}
            onClick={onScrim}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sheet && (
          <Sheet key={`sheet-${sheet.key}`} options={sheet.options} onClose={closeSheet}>
            {sheet.render(closeSheet)}
          </Sheet>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {popover && (
          <Popover key={`pop-${popover.key}`} options={popover.options} onClose={closePopover}>
            {popover.render(closePopover)}
          </Popover>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dialog && (
          <ConfirmDialog
            key={`dialog-${dialog.key}`}
            options={dialog.options}
            onSettle={settleDialog}
          />
        )}
      </AnimatePresence>
      <Toasts items={toasts} onDismiss={dismissToast} slow={SLOW} />
    </Ctx.Provider>
  );
}

export function useOverlay(): OverlayApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOverlay outside OverlayProvider');
  return v;
}
