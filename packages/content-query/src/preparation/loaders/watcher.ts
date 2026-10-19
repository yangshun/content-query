import type { FSWatcher } from "chokidar";
import type { LoaderContext } from "../../loaders/types.ts";

type Listener = (...arguments_: unknown[]) => unknown;
type Event = Parameters<FSWatcher["on"]>[0];

/** Guards loader-owned watcher callbacks and exposes cleanup for abandoned load attempts. */
export function guardedWatcher(
  watcher: FSWatcher,
  run: (callback: () => unknown) => Promise<void>,
  failed: (cause: unknown) => void,
): { watcher: LoaderContext["watcher"]; cleanup(): void } {
  const listeners: { event: Event; original: Listener; wrapped: Listener }[] = [];
  let running = Promise.resolve();
  const registration = new Set([
    "on",
    "once",
    "addListener",
    "prependListener",
    "prependOnceListener",
  ]);
  const facade = new Proxy(watcher, {
    get(target, property, receiver) {
      if (typeof property === "string" && registration.has(property)) {
        return (event: Event, original: Listener) => {
          const wrapped: Listener = (...arguments_) => {
            running = running
              .then(() => run(() => Reflect.apply(original, facade, arguments_)))
              .catch(failed);
          };
          listeners.push({ event, original, wrapped });
          const method = property as "on" | "once";
          target[method](event, wrapped);
          return facade;
        };
      }
      if (
        property === "off" ||
        property === "removeListener" ||
        property === "removeAllListeners"
      ) {
        return (event?: Event, original?: Listener) => {
          for (let index = listeners.length - 1; index >= 0; index--) {
            const listener = listeners[index]!;
            if (
              (event === undefined || listener.event === event) &&
              (original === undefined || listener.original === original)
            ) {
              target.off(listener.event, listener.wrapped);
              listeners.splice(index, 1);
            }
          }
          return facade;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function"
        ? (...arguments_: unknown[]) => {
            const result: unknown = Reflect.apply(value, target, arguments_);
            return result === target ? facade : result;
          }
        : value;
    },
  });
  return {
    watcher: facade as unknown as LoaderContext["watcher"],
    cleanup() {
      for (const { event, wrapped } of listeners) {
        watcher.off(event, wrapped);
      }
      listeners.length = 0;
    },
  };
}
