import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite-plus";
import { buildAtRoot, type BuildContentOptions } from "../../preparation/build.ts";
import { resolveConfigPath } from "../../preparation/config-path.ts";
import { revisionModules } from "../../artifacts/modules.ts";
import { writeChanged } from "../../artifacts/write.ts";
import { virtualDeclarations } from "../../artifacts/declarations.ts";
import { sessionInternals, type ContentSession } from "../../preparation/session.ts";
import type { ContentState, PreparedRevision } from "../../runtime/revision.ts";
import type { ContentError } from "../../shared/errors.ts";

import { clientEnvironment, physicalPath, forbidden } from "./client-boundary.ts";
import { withinDirectory } from "../../shared/paths.ts";
import {
  facade,
  preparedFacade,
  virtualPrefix,
  preparedModules,
  devFacade,
  clientFacade,
  clientModule,
  devClient,
} from "./modules.ts";

const bridgeSymbol = Symbol.for("content-query.dev-sessions");
type BridgeGlobal = typeof globalThis & { [bridgeSymbol]?: Map<string, ContentSession> };

/** Integrates in-memory content with Vite; opt into generated storage for standalone artifacts. */
export function contentQuery(options: Omit<BuildContentOptions, "watch"> = {}): Plugin {
  let config: ResolvedConfig;
  let building = false;
  let server: ViteDevServer | undefined;
  let session: ContentSession | undefined;
  let starting: Promise<ContentSession> | undefined;
  let modules = new Map<string, string>();
  let deliveredRevision: PreparedRevision | undefined;
  let deliveredError: ContentError | undefined;
  let encoding:
    | {
        revision: PreparedRevision | undefined;
        error: ContentError | undefined;
        pending: Promise<Map<string, string>>;
      }
    | undefined;
  const bridgeKey = randomUUID();
  const refreshClients = new WeakSet<object>();

  /** Publishes type-only facade binding without importing configuration in executable code. */
  async function writeTypes(configPath: string): Promise<void> {
    const directory = path.join(config.root, ".content-query");
    await writeChanged(
      path.join(directory, "types.d.ts"),
      virtualDeclarations(directory, configPath),
    );
  }
  /** Notifies the host after atomic publication or a recoverable preparation failure. */
  async function refreshModules(state: ContentState): Promise<void> {
    const revision = state.revision;
    const error = state.error;
    if (deliveredRevision === revision && deliveredError === error && modules.size) {
      return;
    }
    if (!encoding || encoding.revision !== revision || encoding.error !== error) {
      encoding = { revision, error, pending: preparedModules(state) };
    }
    const current = encoding;
    try {
      const next = await current.pending;
      if (state.revision !== revision || state.error !== error) {
        await refreshModules(state);
        return;
      }
      if (deliveredRevision === revision && deliveredError === error && modules.size) {
        return;
      }
      modules = new Map([...modules, ...next]);
      deliveredRevision = revision;
      deliveredError = error;
    } finally {
      if (encoding === current) {
        encoding = undefined;
      }
    }
  }
  /** Notifies every host environment after portable state modules are ready. */
  async function changed(state: ContentState): Promise<void> {
    await refreshModules(state);
    if (!server) {
      return;
    }
    for (const environment of Object.values(server.environments)) {
      const boundary = environment.moduleGraph.getModuleById(`${virtualPrefix}server.js`);
      const prepared = environment.moduleGraph.getModuleById(`${virtualPrefix}prepared-server.js`);
      for (const module of environment.moduleGraph.idToModuleMap.values()) {
        if (module.id === `${virtualPrefix}prepared-server.js`) {
          environment.moduleGraph.invalidateModule(module);
        }
      }
      if (boundary && prepared) {
        environment.hot.send({
          type: "update",
          updates: [
            {
              type: "js-update",
              timestamp: Date.now(),
              path: boundary.url,
              acceptedPath: prepared.url,
              explicitImportRequired: false,
              isWithinCircularImport: false,
            },
          ],
        });
      }
    }
    if (state.error) {
      server.ws.send({
        type: "error",
        err: {
          message: state.error.message,
          stack: state.error.stack ?? "",
          plugin: "content-query",
        },
      });
    } else {
      server.ws.send({ type: "custom", event: "content-query:update", data: {} });
      for (const client of server.ws.clients) {
        if (!refreshClients.has(client)) {
          client.send({ type: "full-reload" });
        }
      }
    }
  }
  /** Reports rejected host notifications instead of leaving a detached promise unhandled. */
  function deliveryFailed(cause: unknown): void {
    const message = `[content-query] Could not deliver prepared content: ${cause instanceof Error ? cause.message : String(cause)}`;
    config.logger.error(message);
    try {
      server?.ws.send({
        type: "error",
        err: {
          message,
          stack: cause instanceof Error ? (cause.stack ?? "") : "",
          plugin: "content-query",
        },
      });
    } catch {
      // The failed delivery may itself be an unavailable transport; the logger still reports it.
    }
  }
  /** Starts exactly one host-owned preparation/watch session. */
  async function ensureSession(): Promise<ContentSession> {
    starting ??= resolveConfigPath(config.root, options.config).then(async (configPath) => {
      const prepared = await buildAtRoot(
        config.root,
        {
          ...options,
          backend: options.backend ?? "in-memory",
          config: configPath,
          watch:
            !building &&
            !config.isProduction &&
            config.command === "serve" &&
            config.server.watch !== null,
        },
        (state) => {
          if (config.command === "serve") {
            void changed(state).catch(deliveryFailed);
          }
        },
      );
      session = prepared;
      try {
        if (config.command === "serve") {
          const global = globalThis as BridgeGlobal;
          global[bridgeSymbol] ??= new Map();
          global[bridgeSymbol].set(bridgeKey, prepared);
          await refreshModules(sessionInternals(prepared).state);
        }
        await writeTypes(configPath);
      } catch (cause) {
        await prepared.dispose();
        (globalThis as BridgeGlobal)[bridgeSymbol]?.delete(bridgeKey);
        throw cause;
      }
      return prepared;
    });
    return starting;
  }
  return {
    name: "content-query",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
      building ||= resolved.command === "build";
      if (resolved.server.watch !== null) {
        const ignored = resolved.server.watch?.ignored;
        const output = path.resolve(resolved.root, options.outDir ?? "./.content-query");
        resolved.server.watch = {
          ...resolved.server.watch,
          ignored: [
            ...(ignored === undefined ? [] : Array.isArray(ignored) ? ignored : [ignored]),
            (filename) => withinDirectory(output, path.resolve(filename)),
          ],
        };
      }
    },
    configureServer(viteServer) {
      server = viteServer;
      server.ws.on("content-query:subscribe", (_data, client) => refreshClients.add(client));
      server.ws.on("content-query:unsubscribe", (_data, client) => refreshClients.delete(client));
      // Vite configures plugins sequentially. Start preparation here so it can overlap the
      // remaining hooks; buildStart and module loads still await it before serving content.
      // Observe rejection now while leaving the initialization hook to report startup errors.
      void ensureSession().catch(() => {});
    },
    async buildStart() {
      if (config.command === "build" && clientEnvironment(this, config)) {
        return;
      }
      const prepared = await ensureSession();
      if (config.command === "build") {
        modules = await revisionModules(sessionInternals(prepared).state.revision!, {
          payloadChunkBytes: 128 * 1024,
        });
      }
    },
    resolveId(source, importer, resolveOptions) {
      if (
        clientEnvironment(this, config, resolveOptions.ssr) &&
        forbidden(source, config, options, importer)
      ) {
        this.error(
          `[content-query] Server-only import "${source}" is reachable from a client module${importer ? `: ${importer}` : "."}`,
        );
      }
      if (source === facade) {
        return `${virtualPrefix}server.js`;
      }
      if (source === clientFacade) {
        return clientModule;
      }
      if (source === preparedFacade) {
        return `${virtualPrefix}prepared-server.js`;
      }
      if (source.startsWith(virtualPrefix)) {
        return source;
      }
      if (source.startsWith(".") && importer?.startsWith(virtualPrefix)) {
        return `${virtualPrefix}${path.posix.normalize(path.posix.join(path.posix.dirname(importer.slice(virtualPrefix.length)), source))}`;
      }
      if (
        physicalPath(source, config, importer) ===
        path.resolve(config.root, options.outDir ?? "./.content-query", "server.js")
      ) {
        return `${virtualPrefix}server.js`;
      }
      return undefined;
    },
    async load(id, loadOptions) {
      if (id === clientModule) {
        return devClient(config.command === "serve");
      }
      if (!id.startsWith(virtualPrefix)) {
        return undefined;
      }
      if (clientEnvironment(this, config, loadOptions?.ssr)) {
        this.error("[content-query] Content runtime cannot be loaded by the client.");
      }
      await ensureSession();
      if (config.command === "serve") {
        await refreshModules(sessionInternals(session!).state);
        if (id === `${virtualPrefix}server.js`) {
          return devFacade(bridgeKey);
        }
        if (id === `${virtualPrefix}prepared-server.js`) {
          return modules.get("server.js");
        }
        return modules.get(id.slice(virtualPrefix.length));
      }
      return modules.get(id.slice(virtualPrefix.length));
    },
    transform(_code, id, transformOptions) {
      if (
        clientEnvironment(this, config, transformOptions?.ssr) &&
        forbidden(id, config, options)
      ) {
        this.error(`[content-query] Server-only module is reachable from the client: ${id}`);
      }
    },
    async closeBundle() {
      server = undefined;
      // createServer() can be closed before listen() starts the client build hooks.
      await starting?.catch(() => undefined);
      await session?.dispose();
      (globalThis as BridgeGlobal)[bridgeSymbol]?.delete(bridgeKey);
    },
  };
}
