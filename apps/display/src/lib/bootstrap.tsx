import { ApiRequestError, type ResponseOf } from '@mantel/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type Bootstrap = ResponseOf<'bootstrap'>;

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: Bootstrap }
  | { status: 'unpaired' }
  | { status: 'error'; message: string };

const Ctx = createContext<{ state: State; reload: () => void } | null>(null);

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const reload = useCallback(() => {
    setState({ status: 'loading' });
    api
      .call('bootstrap')
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) setState({ status: 'unpaired' });
        else
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, []);
  useEffect(reload, [reload]);
  return <Ctx.Provider value={{ state, reload }}>{children}</Ctx.Provider>;
}

export function useBootstrapState() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBootstrapState outside BootstrapProvider');
  return v;
}

/** The loaded bootstrap. Only call below the shell, which renders children once it is ready. */
export function useBootstrap(): Bootstrap {
  const { state } = useBootstrapState();
  if (state.status !== 'ready') throw new Error('bootstrap not loaded');
  return state.data;
}
