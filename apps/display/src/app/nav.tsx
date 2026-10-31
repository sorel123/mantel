import { createContext, useContext, type ReactNode } from 'react';
import type { ScreenId } from './screens';

export interface Nav {
  current: ScreenId;
  /** Switch to a screen (closes any open overlay first). */
  go: (id: ScreenId) => void;
}

const Ctx = createContext<Nav>({ current: 'today', go: () => {} });

/** Gives screens a way to move to another screen: the grocery card on Today opens Lists. */
export function NavProvider({ value, children }: { value: Nav; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav(): Nav {
  return useContext(Ctx);
}
