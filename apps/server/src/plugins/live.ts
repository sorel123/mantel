/**
 * A stand-in object that forwards every property read and method call to whatever instance is
 * current. Routes and the WebSocket hub hold one of these per provider, so a plugin can rebuild
 * its provider with new credentials and nothing upstream notices.
 */
export interface Live<T extends object> {
  /** The forwarding stand-in; hand this to routes. */
  proxy: T;
  /** The instance calls go to right now. */
  current(): T;
  set(next: T): void;
}

export function live<T extends object>(initial: T): Live<T> {
  let instance = initial;
  const proxy = new Proxy({} as T, {
    get(_target, prop) {
      const value = Reflect.get(instance as object, prop) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(instance)
        : value;
    },
    has(_target, prop) {
      return prop in (instance as object);
    },
    ownKeys() {
      return Reflect.ownKeys(instance as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const d = Reflect.getOwnPropertyDescriptor(instance as object, prop);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
  return {
    proxy,
    current: () => instance,
    set: (next) => {
      instance = next;
    },
  };
}
