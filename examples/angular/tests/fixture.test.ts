import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startProcess } from "./fixture";

describe("Angular fixture process runtime", () => {
  let root: string;
  let nodeVersion: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "content-query-angular-runtime-"));
    nodeVersion = (
      await readFile(new URL("../../../.node-version", import.meta.url), "utf8")
    ).trim();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { "print-node": "node -p process.versions.node" } }),
    );
    // Simulate a conflicting PATH runtime while allowing Node-based CLI launchers to start.
    const installedNode = process.execPath.replaceAll("'", "'\\''");
    await writeFile(
      path.join(root, "node"),
      [
        "#!/bin/sh",
        'if [ "$1" = "-p" ] && [ "$2" = "process.versions.node" ]; then',
        '  echo "unsupported-path-runtime"',
        "  exit 0",
        "fi",
        `exec '${installedNode}' "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test.each([
    { name: "Node on PATH", command: "node", arguments: ["-p", "process.versions.node"] },
    { name: "a Vite+ script", command: "vp", arguments: ["run", "print-node"] },
  ])(
    "uses the workspace Node version for $name outside the workspace",
    async ({ command, arguments: commandArguments }) => {
      const child = startProcess(root, command, commandArguments, {
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
      });
      expect(await child.closed, child.output()).toBe(0);
      expect(child.output().trim().split(/\r?\n/).at(-1)).toBe(nodeVersion);
    },
  );
});
