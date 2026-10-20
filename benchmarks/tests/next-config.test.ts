import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";

const execute = promisify(execFile);
const config = new URL("../apps/next/next.config.mjs", import.meta.url).href;

describe("Next.js benchmark config lifecycle", () => {
  test.each([
    "/next/dist/telemetry/detached-flush.js",
    "C:\\next\\dist\\telemetry\\detached-flush.js",
  ])("does not prepare content or start watchers for telemetry helper %s", async (entrypoint) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "next-benchmark-telemetry-"));
    try {
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `process.argv[1] = ${JSON.stringify(entrypoint)};
const { default: configure } = await import(${JSON.stringify(config)});
console.log(JSON.stringify(await configure("phase-development-server", {})));`,
        ],
        { cwd: directory, timeout: 10_000 },
      );
      expect(JSON.parse(stdout)).toEqual({ trailingSlash: true });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
