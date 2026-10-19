import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { expect, vi } from "vite-plus/test";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const nodeVersion = readFileSync(new URL("../../../.node-version", import.meta.url), "utf8").trim();

/** Copies the real example so tests never edit the shared sample guides. */
export async function createFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-angular-")));
  for (const source of [
    "src",
    "content",
    "content-query.config.ts",
    "angular.json",
    "index.html",
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
  ]) {
    await cp(path.join(appRoot, source), path.join(root, source), { recursive: true });
  }
  const modules = path.join(root, "node_modules");
  await mkdir(path.join(modules, ".bin"), { recursive: true });
  for (const entry of await readdir(path.join(appRoot, "node_modules"))) {
    if (!entry.startsWith(".")) {
      await symlink(path.join(appRoot, "node_modules", entry), path.join(modules, entry), "dir");
    }
  }
  // pnpm's relative binary shims must execute at their real installed location.
  for (const binary of ["content-query", "ng", "concurrently"]) {
    const installed = path.join(appRoot, "node_modules/.bin", binary).replaceAll("'", "'\\''");
    await writeFile(path.join(modules, ".bin", binary), `#!/bin/sh\nexec '${installed}' "$@"\n`, {
      mode: 0o755,
    });
  }
  await mkdir(path.join(root, "content/guides/reference"));
  await writeFile(
    path.join(root, "content/guides/reference/shortcuts.md"),
    "---\ntitle: Shortcuts\ndescription: Keep your hands on the keyboard.\norder: 4\n---\n## Moving around\nUse the keyboard to move between notes.\n",
  );
  return root;
}

/** Runs fixture commands with the workspace's pinned Node and captures diagnostics. */
export function startProcess(
  root: string,
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
) {
  const child = spawn("vp", ["env", "exec", "--node", nodeVersion, "--", command, ...arguments_], {
    cwd: root,
    env: {
      ...process.env,
      VITEST: undefined,
      NODE_ENV: undefined,
      NG_CLI_ANALYTICS: "false",
      NG_BUILD_MAX_WORKERS: "2",
      ...environment,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { child, closed, output: () => stripVTControlCharacters(output) };
}

/** Waits for a server's ephemeral port, surfacing startup failures. */
export async function serverOrigin(server: ReturnType<typeof startProcess>) {
  let origin = "";
  await Promise.race([
    vi.waitFor(
      () => {
        if (server.child.exitCode !== null) {
          throw new Error(server.output());
        }
        origin = server.output().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? "";
        expect(origin).not.toBe("");
      },
      { timeout: 60_000, interval: 100 },
    ),
    server.closed.then(() => {
      throw new Error(server.output());
    }),
  ]);
  return origin;
}

/** Stops the whole dev command, including its content watcher. */
export async function stopProcess(
  server: { child: ChildProcess; closed: Promise<number | null> } | undefined,
) {
  if (!server) {
    return;
  }
  if (server.child.pid && server.child.exitCode === null && server.child.signalCode === null) {
    process.kill(-server.child.pid, "SIGTERM");
  }
  await server.closed;
}

/** Removes only a fixture created by this test helper. */
export async function removeFixture(root: string | undefined) {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
}
