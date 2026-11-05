import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { bundlerArguments, createFixture, nextReleases } from "./next-releases";

const servers = nextReleases.flatMap((release) =>
  (["turbopack", "webpack"] as const).map((bundler) => ({
    release,
    bundler,
    label: `Next.js ${release.version} ${bundler}`,
  })),
);

describe("Next.js development content integration", () => {
  test.each(servers)(
    "$label serves published content changes and recovers from invalid edits without restarting",
    async ({ release, bundler }) => {
      const fixture = await createFixture(release);
      const outDir = path.join(fixture.root, ".content-query");
      const payloadDirectory = path.join(outDir, "collections/guides/entries");
      const stalePayload = path.join(payloadDirectory, `${"0".repeat(64)}.js`);
      const entryDirectory = path.join(outDir, "collections/guides");
      const staleRuntime = path.join(
        entryDirectory,
        "next-dev-00000000-0000-0000-0000-000000000000.js",
      );
      await mkdir(payloadDirectory, { recursive: true });
      await writeFile(stalePayload, "Previous run");
      await writeFile(staleRuntime, "Previous run");
      const child = spawn(
        process.execPath,
        [
          fixture.next,
          "dev",
          ...bundlerArguments(release, bundler),
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
        const initialRuntime = (await readdir(entryDirectory)).find((filename) =>
          /^next-dev-.*\.js$/.test(filename),
        )!;
        const post = path.join(fixture.root, "content/guides/getting-started.md");
        const original = await readFile(post, "utf8");
        const updated = original.replace("title: Getting started", "title: Updated in development");
        await writeFile(post, updated);
        await vi.waitFor(async () => {
          expect((await request(route)).html).toContain("Updated in development");
        }, waits);
        // Earlier revisions stay importable for the rest of the session.
        expect(await readFile(path.join(entryDirectory, initialRuntime), "utf8")).toContain(
          "createArtifactCollection",
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
        const directory = path.join(fixture.root, ".content-query/collections/guides");
        const entry = await readFile(path.join(directory, "server.js"), "utf8");
        const runtime = entry.match(/from "\.\/(next-dev-[a-f0-9-]+\.js)"/)?.[1];
        const published = runtime ? await readFile(path.join(directory, runtime), "utf8") : entry;
        const collection = published.match(/from "\.\/(index-[a-f0-9]+\.js)"/)?.[1];
        const index = collection
          ? await readFile(path.join(directory, collection), "utf8")
          : published;
        console.error(
          `Next.js ${release.version} ${bundler} diagnostics:\n${output.slice(-4_000)}\nPublished collection:\n${index.slice(-3_000)}`,
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
