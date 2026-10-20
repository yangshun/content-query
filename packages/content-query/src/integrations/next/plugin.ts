import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { buildAtRoot, type BuildContentOptions } from "../../preparation/build.ts";
import { resolveConfigPath } from "../../preparation/config-path.ts";
import type { ContentSession } from "../../preparation/session.ts";
import { pruneDevelopmentEntries, publishDevelopment } from "./publication.ts";

/** Content locations for Next.js; the adapter chooses generated storage and the watch lifecycle. */
export type NextContentOptions = Pick<BuildContentOptions, "config" | "outDir">;
type ConfigContext = { defaultConfig: NextConfig };
type ConfigInput =
  | NextConfig
  | Promise<NextConfig>
  | ((phase: string, context: ConfigContext) => NextConfig | Promise<NextConfig>);
type DevelopmentEntry = { key: string; ready: Promise<ContentSession> };
type DevelopmentOwner = {
  entries: Map<string, DevelopmentEntry>;
  shutdown?: () => void;
};
const ownerSymbol = Symbol.for("content-query.next-sessions");
const global = globalThis as typeof globalThis & { [ownerSymbol]?: DevelopmentOwner };
const owner: DevelopmentOwner = (global[ownerSymbol] ??= { entries: new Map() });

/** Removes signal listeners when this adapter no longer owns any development sessions. */
function unobserveShutdown(): void {
  if (owner.entries.size === 0 && owner.shutdown) {
    process.removeListener("SIGINT", owner.shutdown);
    process.removeListener("SIGTERM", owner.shutdown);
    owner.shutdown = undefined;
  }
}

/** Registers one process-level cleanup while Next retains ownership of process termination. */
function observeShutdown(): void {
  if (owner.shutdown) {
    return;
  }
  owner.shutdown = () => {
    const entries = [...owner.entries.values()];
    owner.entries.clear();
    unobserveShutdown();
    void Promise.allSettled(entries.map(async (entry) => (await entry.ready).dispose())).then(
      (results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            console.error("[content-query] Could not close Next.js content session", result.reason);
          }
        }
      },
    );
  };
  process.once("SIGINT", owner.shutdown);
  process.once("SIGTERM", owner.shutdown);
}

/** Closes a previous development session before a production build in the same process. */
async function stopDevelopment(root: string): Promise<void> {
  const entry = owner.entries.get(root);
  if (entry) {
    owner.entries.delete(root);
    unobserveShutdown();
    await (await entry.ready).dispose();
  }
}

/** Reuses a pending session and serializes replacement when content locations change. */
async function startDevelopment(root: string, options: NextContentOptions): Promise<void> {
  const config = await resolveConfigPath(root, options.config);
  const outDir = path.resolve(root, options.outDir ?? "./.content-query");
  const key = JSON.stringify([config, outDir]);
  const previous = owner.entries.get(root);
  if (previous?.key === key) {
    await previous.ready;
    return;
  }
  const entry: DevelopmentEntry = {
    key,
    ready: Promise.resolve().then(async () => {
      if (previous) {
        await (await previous.ready).dispose();
      }
      let firstPublication = true;
      return buildAtRoot(root, { config, outDir, backend: "generated", watch: true }, (state) => {
        const runtime = publishDevelopment(outDir, config, state, { prune: firstPublication });
        if (runtime) {
          firstPublication = false;
        }
      });
    }),
  };
  owner.entries.set(root, entry);
  observeShutdown();
  try {
    await entry.ready;
  } catch (cause) {
    if (owner.entries.get(root) === entry) {
      owner.entries.delete(root);
      unobserveShutdown();
    }
    throw cause;
  }
}

/**
 * Builds content before Next compiles, retaining one managed watcher during `next dev`.
 * Import the generated server entry from Server Components; Next's HMR observes its updates.
 * Next's detached telemetry helper evaluates configuration without starting content sessions.
 * @param nextConfig Existing object, promise, or phase-aware Next.js configuration.
 * @param options Optional content configuration file and generated output directory.
 * @returns An asynchronous Next.js configuration function that owns the content lifecycle.
 */
export function withContentQuery(
  nextConfig: ConfigInput = {},
  options: NextContentOptions = {},
): (phase: string, context: ConfigContext) => Promise<NextConfig> {
  const root = process.cwd();
  return async (phase, context) => {
    const config = await (typeof nextConfig === "function"
      ? nextConfig(phase, context)
      : nextConfig);
    // Next's detached telemetry process also loads development config and must exit naturally.
    if (process.argv[1]?.replaceAll("\\", "/").endsWith("/telemetry/detached-flush.js")) {
      return config;
    }
    if (phase === PHASE_DEVELOPMENT_SERVER) {
      await startDevelopment(root, options);
    } else if (phase === PHASE_PRODUCTION_BUILD) {
      await stopDevelopment(root);
      const session = await buildAtRoot(root, { ...options, backend: "generated", watch: false });
      await session.dispose();
      pruneDevelopmentEntries(path.resolve(root, options.outDir ?? "./.content-query"));
    }
    return config;
  };
}
