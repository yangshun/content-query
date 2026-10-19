import type { PrepareContentOptions } from "../../build.ts";

/** Parses the intentionally small, strict standalone preparation command. */
export function parseArguments(arguments_: string[]): PrepareContentOptions {
  if (arguments_.shift() !== "prepare") {
    throw new Error(
      "Usage: content-query prepare [--config file] [--backend generated|in-memory] [--out-dir dir] [--watch]",
    );
  }
  const options: PrepareContentOptions = {};
  const used = new Set<string>();
  while (arguments_.length) {
    const flag = arguments_.shift()!;
    if (used.has(flag)) {
      throw new Error(`Repeated flag: ${flag}`);
    }
    used.add(flag);
    if (flag === "--watch") {
      options.watch = true;
      continue;
    }
    if (!["--config", "--backend", "--out-dir"].includes(flag)) {
      throw new Error(`Unknown flag: ${flag}`);
    }
    const value = arguments_.shift();
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--config") {
      options.config = value;
    } else if (flag === "--out-dir") {
      options.outDir = value;
    } else if (value === "generated" || value === "in-memory") {
      options.backend = value;
    } else {
      throw new Error(`Invalid backend: ${value}`);
    }
  }
  return options;
}
