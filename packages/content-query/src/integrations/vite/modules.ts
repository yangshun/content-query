import { revisionModules } from "../../artifacts/modules.ts";
import type { ContentState } from "../../runtime/revision.ts";
import { serializeContentError } from "../../runtime/diagnostics.ts";

export const facade = "content-query:server";
export const preparedFacade = "content-query:prepared-server";
export const clientFacade = "content-query:client";
export const clientModule = "\0content-query:client.js";
export const virtualPrefix = "\0content-query:";

/** Provides a client-safe subscription without exposing the content runtime or registry. */
export function devClient(development: boolean): string {
  if (!development) {
    return "export function onContentUpdate() { return () => {}; }";
  }
  return `const listeners = new Set();
let pending = false;
let refreshing = false;
async function refresh() {
 pending = true;
 if (refreshing) return;
 refreshing = true;
 try {
  while (pending) {
   pending = false;
   try {
    await Promise.all([...listeners].map(callback => Promise.resolve().then(callback)));
    if (typeof document !== "undefined") {
     for (const overlay of document.querySelectorAll("vite-error-overlay")) {
      if (overlay.shadowRoot?.querySelector(".plugin")?.textContent.trim() === "[plugin:content-query]") overlay.close();
     }
    }
   } catch (error) {
    console.error("[content-query] Could not refresh page data", error);
   }
  }
 } finally { refreshing = false; }
}
if (import.meta.hot) {
 import.meta.hot.on("content-query:update", refresh);
 import.meta.hot.on("vite:ws:connect", () => { if (listeners.size) import.meta.hot.send("content-query:subscribe"); });
 import.meta.hot.dispose(() => { listeners.clear(); import.meta.hot.send("content-query:unsubscribe"); });
}
export function onContentUpdate(callback) {
 listeners.add(callback);
 import.meta.hot?.send("content-query:subscribe");
 return () => {
  listeners.delete(callback);
  if (!listeners.size) import.meta.hot?.send("content-query:unsubscribe");
 };
}`;
}

/** Encodes a complete prepared revision or its contextual development error for isolated runtimes. */
export async function preparedModules(state: ContentState): Promise<Map<string, string>> {
  const revision = state.revision;
  const error = state.error;
  let next: Map<string, string>;
  if (error) {
    const serialized = serializeContentError(error);
    next = new Map([
      [
        "server.js",
        `import { restoreContentError } from "content-query/internal"; export const revision = undefined; export const registry = JSON.parse(${JSON.stringify(JSON.stringify(state.registry ?? {}))}); export const error = restoreContentError(${JSON.stringify(serialized)});`,
      ],
    ]);
  } else {
    next = await revisionModules(revision!, { payloadChunkBytes: 128 * 1024 });
    next.set(
      "server.js",
      next
        .get("server.js")!
        .replaceAll("createArtifactRuntime", "createArtifactRevision")
        .replace("export const content =", "export const revision =") +
        "\nexport const registry = revision.registry; export const error = undefined;\n",
    );
  }
  return next;
}

/** Creates the stable facade that accepts revision updates in host and isolated dev runtimes. */
export function devFacade(bridgeKey: string): string {
  return `import { createLiveRuntime } from "content-query/internal";
import * as prepared from ${JSON.stringify(preparedFacade)};
const live = createLiveRuntime(prepared);
export const content = globalThis[Symbol.for("content-query.dev-sessions")]?.get(${JSON.stringify(bridgeKey)})?.content ?? live.content;
if (import.meta.hot) {
 const apply = next => { if (next) live.update(next); };
 import.meta.hot.accept(${JSON.stringify(preparedFacade)}, apply);
 // Module runners unwrap virtual IDs in update messages. Register that form too.
 const hot = import.meta.hot;
 hot.accept(${JSON.stringify(`${virtualPrefix}prepared-server.js`)}, apply);
}`;
}
