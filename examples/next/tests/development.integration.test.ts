import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Creates an isolated app inside the monorepo so Turbopack can resolve its workspace packages. */
async function developmentFixture() {
  const temporaryRoot = path.join(repositoryRoot, ".content-query");
  await mkdir(temporaryRoot, { recursive: true });
  const workspace = await mkdtemp(path.join(temporaryRoot, "next-test-"));
  const root = path.join(workspace, "app");
  await mkdir(root);
  for (const source of [
    "app",
    "content",
    "content-query.config.ts",
    "next.config.mjs",
    "package.json",
    "tsconfig.json",
  ]) {
    await cp(path.join(appRoot, source), path.join(root, source), { recursive: true });
  }
  await symlink(path.join(appRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  return { root, workspace };
}

describe("Next.js development content integration", () => {
  test.each(["turbopack", "webpack"])(
    "%s serves published content changes and recovers from invalid edits without restarting",
    async (bundler) => {
      const fixture = await developmentFixture();
      const outDir = path.join(fixture.root, ".content-query");
      const payloadDirectory = path.join(outDir, "collections/guides/entries");
      const stalePayload = path.join(payloadDirectory, `${"0".repeat(64)}.js`);
      const staleRuntime = path.join(outDir, "next-dev-00000000-0000-0000-0000-000000000000.js");
      await mkdir(payloadDirectory, { recursive: true });
      await writeFile(stalePayload, "Previous run");
      await writeFile(staleRuntime, "Previous run");
      const child = spawn(
        process.execPath,
        [
          path.join(appRoot, "node_modules/next/dist/bin/next"),
          "dev",
          `--${bundler}`,
          "--hostname",
          "127.0.0.1",
          "--port",
          "0",
        ],
        {
          cwd: fixture.root,
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      let origin: string | undefined;
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      });
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const closed = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      /** Reads a freshly rendered route while retaining startup diagnostics on failures. */
      async function request(route: string) {
        if (child.exitCode !== null) {
          throw new Error(output);
        }
        const response = await fetch(`${origin}${route}`, { redirect: "manual" });
        return { status: response.status, html: await response.text() };
      }
      const waits = { timeout: 15_000, interval: 200 };
      try {
        await vi.waitFor(
          () => {
            if (child.exitCode !== null) {
              throw new Error(output);
            }
            expect(origin).toBeDefined();
          },
          { timeout: 30_000 },
        );
        const route = "/docs/getting-started";
        expect((await request(route)).status).toBe(200);
        const redirect = await fetch(`${origin}${route}/`, { redirect: "manual" });
        expect(redirect.status).toBe(308);
        expect(redirect.headers.get("location")).toBe(route);
        await expect(readFile(stalePayload, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(staleRuntime, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        const initialRuntime = (await readdir(outDir)).find((filename) =>
          /^next-dev-.*\.js$/.test(filename),
        )!;
        const post = path.join(fixture.root, "content/guides/getting-started.md");
        const original = await readFile(post, "utf8");
        const updated = original.replace("title: Getting started", "title: Updated in development");
        await writeFile(post, updated);
        await vi.waitFor(async () => {
          expect((await request(route)).html).toContain("Updated in development");
        }, waits);
        expect(await readFile(path.join(outDir, initialRuntime), "utf8")).toContain(
          "createArtifactRuntime",
        );

        await writeFile(
          post,
          `${updated}\n## Body-only update\nPublished through the content watcher.\n`,
        );
        await vi.waitFor(async () => {
          expect((await request(route)).html).toContain("Published through the content watcher.");
        }, waits);

        const added = path.join(fixture.root, "content/guides/added-guide.md");
        await writeFile(
          added,
          "---\ntitle: Added guide\ndescription: A new route.\norder: 4\n---\n## Added live\nA new guide.\n",
        );
        await vi.waitFor(async () => {
          const response = await request("/docs/added-guide");
          expect(response.status).toBe(200);
          expect(response.html).toContain("Added live");
        }, waits);
        const renamed = path.join(fixture.root, "content/guides/renamed-guide.md");
        await rename(added, renamed);
        await vi.waitFor(async () => {
          expect((await request("/docs/renamed-guide")).status).toBe(200);
          expect((await request("/docs/added-guide")).status).toBe(404);
        }, waits);
        await rm(renamed);
        await vi.waitFor(async () => {
          expect((await request("/")).html).not.toContain('href="/docs/renamed-guide"');
          expect((await request("/docs/renamed-guide")).status).toBe(404);
        }, waits);

        await writeFile(post, "---\ntitle: false\n---\nInvalid metadata.\n");
        await vi.waitFor(async () => {
          expect((await request(route)).status).toBe(500);
        }, waits);
        await writeFile(post, original);
        await vi.waitFor(async () => {
          const response = await request(route);
          expect(response.status).toBe(200);
          expect(response.html).toContain("Getting started");
        }, waits);

        const config = path.join(fixture.root, "content-query.config.ts");
        const originalConfig = await readFile(config, "utf8");
        await writeFile(
          config,
          originalConfig.replace(
            "title: schema.string()",
            "title: schema.string().transform((title) => `Configured ${title}`)",
          ),
        );
        await vi.waitFor(async () => {
          expect((await request(route)).html).toContain("Configured Getting started");
        }, waits);
        await writeFile(config, "export const collections = {");
        await vi.waitFor(async () => {
          expect((await request(route)).status).toBe(500);
        }, waits);
        await writeFile(config, originalConfig);
        await vi.waitFor(async () => {
          const response = await request(route);
          expect(response.status).toBe(200);
          expect(response.html).toContain("Getting started");
          expect(response.html).not.toContain("Configured Getting started");
        }, waits);
      } catch (cause) {
        const entry = await readFile(path.join(fixture.root, ".content-query/server.js"), "utf8");
        const collection = entry.match(
          /from "(\.\/collections\/guides\/index-[a-f0-9]+\.js)"/,
        )?.[1];
        const index = collection
          ? await readFile(path.join(fixture.root, ".content-query", collection), "utf8")
          : entry;
        console.error(
          `Next.js ${bundler} diagnostics:\n${output.slice(-4_000)}\nPublished collection:\n${index.slice(-3_000)}`,
        );
        throw cause;
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
        }
        await closed;
        await rm(fixture.workspace, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
