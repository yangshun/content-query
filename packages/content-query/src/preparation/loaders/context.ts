import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LoaderConfig } from "../../loaders/types.ts";
import type { LoaderContext } from "../../loaders/types.ts";

/** Supplies portable filesystem defaults and fails explicitly for unavailable Astro settings. */
export function loaderConfig(root: string, overrides: Partial<LoaderConfig> = {}): LoaderConfig {
  const defaults: Partial<LoaderConfig> = {
    root: pathToFileURL(`${path.resolve(root)}${path.sep}`),
    srcDir: pathToFileURL(`${path.resolve(root, "src")}${path.sep}`),
    publicDir: pathToFileURL(`${path.resolve(root, "public")}${path.sep}`),
    outDir: pathToFileURL(`${path.resolve(root, "dist")}${path.sep}`),
    cacheDir: pathToFileURL(`${path.resolve(root, "node_modules/.astro")}${path.sep}`),
    base: "/",
    site: undefined,
    output: "static",
    ...overrides,
  };
  return new Proxy(defaults, {
    get(target, property, receiver) {
      if (typeof property === "string" && !(property in target)) {
        throw new Error(
          `Content loader requires config.${property}; provide loaderConfig.${property} in content-query.config.ts.`,
        );
      }
      return Reflect.get(target, property, receiver);
    },
  }) as LoaderConfig;
}

/** Creates the public Astro logger shape without importing Astro's framework runtime. */
export function loaderLogger(
  label: string,
  options: LoaderContext["logger"]["options"] = {
    level: "info",
    destination: {
      write: ({ label: name, level, message }) => {
        if (level !== "silent") {
          console[level](`[${name}] ${message}`);
        }
      },
    },
  },
): LoaderContext["logger"] {
  /** Routes messages through the shared logger options and configured level. */
  function emit(level: "debug" | "info" | "warn" | "error", message: string): void {
    const ranks = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
    if (ranks[level] >= ranks[options.level]) {
      options.destination.write({ label, level, message, newLine: true });
    }
  }
  return {
    label,
    options,
    fork: (name) => loaderLogger(name, options),
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message),
    debug: (message) => emit("debug", message),
    flush: () => {
      void options.destination.flush?.();
    },
    close: () => {
      void options.destination.close?.();
    },
  };
}
