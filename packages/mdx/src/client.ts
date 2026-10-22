import { parse } from "devalue";
import { loadReference } from "./client/modules.ts";
import type { MdxClientReference, MdxModule } from "./types.ts";

export type { MdxClientReference, MdxModule } from "./types.ts";
export { loadStyle } from "./client/modules.ts";

type IslandModule = {
  mount(
    element: HTMLElement,
    props: Record<string, unknown>,
    options: { clientOnly: boolean; prefix: string; onError: (cause: unknown) => void },
  ): () => void;
};
/** Optional reporting hook; scheduling and mounting failures stay isolated to the affected widget. */
export type MountIslandsOptions = {
  onError?(cause: unknown, element: HTMLElement): void;
  /** Cancels scheduling immediately and tears down roots after the host React commit finishes. */
  deferUnmount?: boolean;
};
const scopes = new WeakMap<ParentNode, () => void>();
const owned = new WeakSet<HTMLElement>();

/** Loads only the document selected by the server, ready to render in an existing React root. */
export function loadMdx(reference: MdxClientReference): Promise<MdxModule> {
  return loadReference<MdxModule>(reference);
}

/** Schedules a document's independent roots and returns an idempotent, race-safe cleanup function. */
export function mountIslands(
  root: ParentNode = document,
  options: MountIslandsOptions = {},
): () => void {
  const existing = scopes.get(root);
  if (existing) {
    return existing;
  }
  let disposed = false;
  const cleanups = new Set<() => void>();
  const elements = [...root.querySelectorAll<HTMLElement>("[data-cq-island]")];
  if (root instanceof HTMLElement && root.matches("[data-cq-island]")) {
    elements.unshift(root);
  }
  /** Cancels timers and observers and unmounts every committed root before the host removes DOM. */
  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    scopes.delete(root);
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (cause) {
        console.error("[content-query/mdx] Island cleanup failed", cause);
      }
    }
    cleanups.clear();
  }
  scopes.set(root, dispose);
  for (const element of elements) {
    if (owned.has(element)) {
      continue;
    }
    owned.add(element);
    cleanups.add(() => {
      owned.delete(element);
      delete element.dataset.cqMounted;
    });
    let started = false;
    /** Reports a widget failure while allowing other widgets to initialize normally. */
    function report(cause: unknown): void {
      if (!disposed) {
        if (options.onError) {
          options.onError(cause, element);
        } else {
          console.error("[content-query/mdx] Island initialization failed", cause);
        }
      }
    }
    /** Imports React and the widget only after its scheduling condition has been met. */
    async function start(): Promise<void> {
      if (disposed || started) {
        return;
      }
      started = true;
      try {
        const entry = JSON.parse(element.dataset.cqEntry!) as MdxClientReference;
        const props = parse(element.dataset.cqProps!) as Record<string, unknown>;
        const module = await loadReference<IslandModule>(entry);
        if (disposed || !element.isConnected) {
          return;
        }
        const cleanup = module.mount(element, props, {
          clientOnly: element.dataset.cqStrategy === "only",
          prefix: element.dataset.cqPrefix!,
          onError: report,
        });
        /** Isolates deferred React teardown failures just like synchronous scheduler cleanups. */
        function unmount(): void {
          try {
            cleanup();
          } catch (cause) {
            console.error("[content-query/mdx] Island cleanup failed", cause);
          }
        }
        cleanups.add(() => {
          if (options.deferUnmount) {
            queueMicrotask(unmount);
          } else {
            unmount();
          }
        });
        element.dataset.cqMounted = "true";
      } catch (cause) {
        report(cause);
      }
    }
    const strategy = element.dataset.cqStrategy;
    if (strategy === "visible" && typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void start();
        }
      });
      observer.observe(element);
      cleanups.add(() => observer.disconnect());
    } else if (strategy === "idle") {
      /** Uses browser idle scheduling after load, with a cancellable timer fallback. */
      function idle(): void {
        if (disposed) {
          return;
        }
        if (typeof window.requestIdleCallback === "function") {
          const handle = window.requestIdleCallback(
            () => {
              void start();
            },
            { timeout: 2000 },
          );
          cleanups.add(() => window.cancelIdleCallback(handle));
        } else {
          const handle = window.setTimeout(() => {
            void start();
          }, 0);
          cleanups.add(() => window.clearTimeout(handle));
        }
      }
      if (document.readyState === "complete") {
        idle();
      } else {
        window.addEventListener("load", idle, { once: true });
        cleanups.add(() => window.removeEventListener("load", idle));
      }
    } else {
      void start();
    }
  }
  return dispose;
}
