import {
  WS_PATH,
  parseWsEvent,
  type WsEvent,
  type WsEventType,
  type WsPayload,
} from '@mantel/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { getStoredKey } from './api';

type Listener = (event: WsEvent) => void;
export type Connection = 'connecting' | 'open' | 'closed';

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let status: Connection = 'closed';
let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(next: Connection) {
  status = next;
  statusListeners.forEach((l) => l());
}

/** Open the shared socket, reconnecting with backoff (1 s doubling to 30 s). Idempotent. */
export function connectEvents() {
  if (socket) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const key = getStoredKey();
  socket = new WebSocket(
    `${proto}://${location.host}${WS_PATH}${key ? `?key=${encodeURIComponent(key)}` : ''}`,
  );
  setStatus('connecting');
  socket.onopen = () => {
    retry = 0;
    setStatus('open');
  };
  socket.onmessage = (msg) => {
    const event = typeof msg.data === 'string' ? parseWsEvent(msg.data) : null;
    if (!event) return;
    if (event.type === 'display.reload') location.reload();
    listeners.forEach((l) => l(event));
  };
  socket.onclose = () => {
    socket = null;
    setStatus('closed');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectEvents, Math.min(30_000, 1000 * 2 ** retry++));
  };
}

export function onServerEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run `handler` for every server event of `type` while the component is mounted. */
export function useServerEvent<T extends WsEventType>(
  type: T,
  handler: (payload: WsPayload<T>) => void,
) {
  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === type) handler(e.payload as WsPayload<T>);
      }),
    [type, handler],
  );
}

export function useConnection(): Connection {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
  );
}
