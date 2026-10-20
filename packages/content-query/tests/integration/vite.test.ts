import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  build,
  createServer,
  isRunnableDevEnvironment,
  type InlineConfig,
  type ViteDevServer,
} from "vite-plus";
import { describe, expect, test, vi } from "vite-plus/test";
import { contentQuery } from "../../src/vite.ts";
import { projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);
const watcherWait = { timeout: 5_000 };
// Application code stays fixed; delayed startup events for it must not replace the test runtime.
const devServer = {
  middlewareMode: true,
  ws: false,
  watch: { ignored: ["**/consumer.mjs"] },
} satisfies NonNullable<InlineConfig["server"]>;
vi.setConfig({ testTimeout: 20_000 });

describe("Vite preparation and server/client boundaries", () => {
  test("refreshes subscribed clients and retains reload fallback for other clients", async () => {
    const fixture = await projectFixture();
    const plugin = contentQuery({ backend: "in-memory" });
    const configure = plugin.configureServer as (server: ViteDevServer) => Promise<void>;
    const registrations = new Map<string, (data: unknown, client: object) => void>();
    plugin.configureServer = async function (server) {
      const registration = vi.spyOn(server.ws, "on");
      await configure.call(this, server);
      for (const [event, callback] of registration.mock.calls) {
        registrations.set(event, callback as (data: unknown, client: object) => void);
      }
    };
    const server = await createServer({
      configFile: false,
      root: fixture.root,
      logLevel: "silent",
      plugins: [plugin],
      server: devServer,
      optimizeDeps: { noDiscovery: true },
    });
    const subscribed = { send: vi.fn() };
    const fallback = { send: vi.fn() };
    const clients = new Set<import("vite-plus").WebSocketClient>();
    vi.spyOn(server.ws, "clients", "get").mockReturnValue(clients);
    clients.add(subscribed as never);
    clients.add(fallback as never);
    const sent = vi.spyOn(server.ws, "send");
    const subscribe = registrations.get("content-query:subscribe")!;
    const unsubscribe = registrations.get("content-query:unsubscribe")!;
    try {
      subscribe({}, subscribed);
      await writeFile(
        fixture.postPath,
        "---\ntitle: Live edit\nauthorId: ada\ndate: 2026-01-01\n---\n",
      );
      await vi.waitFor(
        () => expect(fallback.send).toHaveBeenCalledWith({ type: "full-reload" }),
        watcherWait,
      );
      expect(sent).toHaveBeenCalledWith({ type: "custom", event: "content-query:update", data: {} });
      expect(subscribed.send).not.toHaveBeenCalledWith({ type: "full-reload" });
      unsubscribe({}, subscribed);
      await writeFile(
        fixture.postPath,
        "---\ntitle: Later edit\nauthorId: ada\ndate: 2026-01-01\n---\n",
      );
      await vi.waitFor(
        () => expect(subscribed.send).toHaveBeenCalledWith({ type: "full-reload" }),
        watcherWait,
      );
    } finally {
      clients.delete(subscribed as never);
      clients.delete(fallback as never);
      await server.close();
      await fixture.dispose();
    }
  });
  test("reports asynchronous delivery failures even when the transport is unavailable", async () => {
    const fixture = await projectFixture();
    const server = await createServer({
      configFile: false,
      root: fixture.root,
      logLevel: "silent",
      plugins: [contentQuery({ backend: "in-memory" })],
      server: devServer,
      optimizeDeps: { noDiscovery: true },
    });
    const logged = vi.spyOn(server.config.logger, "error").mockImplementation(() => {});
    const delivery = vi.spyOn(server.ws, "send").mockImplementation(() => {
      throw new Error("Transport unavailable");
    });
    try {
      await writeFile(
        fixture.postPath,
        "---\ntitle: Edited\nauthorId: ada\ndate: 2026-01-01\n---\n",
      );
      await vi.waitFor(
        () => expect(logged).toHaveBeenCalledWith(expect.stringContaining("Transport unavailable")),
        watcherWait,
      );
    } finally {
      delivery.mockRestore();
      logged.mockRestore();
      await server.close();
      await fixture.dispose();
    }
  });
  test("delivers live dev revisions without sharing the preparation process's memory", async () => {
    const fixture = await projectFixture();
    await writeFile(
      path.join(fixture.root, "consumer.mjs"),
      'export {content} from "content-query:server";',
    );
    const server = await createServer({
      configFile: false,
      root: fixture.root,
      logLevel: "silent",
      plugins: [contentQuery({ backend: "in-memory" })],
      server: devServer,
      optimizeDeps: { noDiscovery: true },
    });
    const bridge = Symbol.for("content-query.dev-sessions");
    const previous = Reflect.get(globalThis, bridge);
    Reflect.deleteProperty(globalThis, bridge);
    try {
      const environment = server.environments.ssr!;
      if (!isRunnableDevEnvironment(environment)) {
        throw new Error("Expected a runnable SSR environment.");
      }
      const { content } = await environment.runner.import("/consumer.mjs");
      const listing = content.query("posts").select("title");
      expect(await listing.first()).toEqual({ title: "Getting started" });
      await writeFile(
        fixture.postPath,
        "---\ntitle: Portable update\nauthorId: ada\ndate: 2026-01-02\n---\n## Updated\n",
      );
      await vi.waitFor(
        async () => expect(await listing.first()).toEqual({ title: "Portable update" }),
        watcherWait,
      );
      await writeFile(fixture.postPath, "---\ntitle: false\n---\n");
      await vi.waitFor(
        async () =>
          expect(listing.count()).rejects.toMatchObject({
            code: "validation-error",
            collection: "posts",
          }),
        watcherWait,
      );
      await writeFile(
        fixture.postPath,
        "---\ntitle: Portable recovery\nauthorId: ada\ndate: 2026-01-02\n---\n",
      );
      await vi.waitFor(
        async () => expect(await listing.first()).toEqual({ title: "Portable recovery" }),
        watcherWait,
      );
    } finally {
      Reflect.set(globalThis, bridge, previous);
      await server.close();
      await fixture.dispose();
    }
  });
  for (const backend of ["generated", "in-memory"] as const) {
    test(`${backend} starts with BigInt validation errors and recovers in an isolated runtime`, async () => {
      const fixture = await projectFixture();
      const filename = path.join(fixture.root, "content/values.json");
      await writeFile(filename, JSON.stringify([{ id: "one", value: "1" }]));
      await writeFile(
        fixture.config,
        `import { defineCollection } from "content-query";
import { file } from "content-query/loaders";
import { z } from "zod";
export const collections = { posts: defineCollection({loader:file("./content/values.json"),schema:z.object({value:z.coerce.bigint().min(10n)})}) };`,
      );
      await writeFile(
        path.join(fixture.root, "consumer.mjs"),
        'export {content} from "content-query:server";',
      );
      let server: Awaited<ReturnType<typeof createServer>> | undefined;
      const bridge = Symbol.for("content-query.dev-sessions");
      const previous = Reflect.get(globalThis, bridge);
      try {
        server = await createServer({
          configFile: false,
          root: fixture.root,
          logLevel: "silent",
          plugins: [contentQuery({ backend })],
          server: devServer,
          optimizeDeps: { noDiscovery: true },
        });
        Reflect.deleteProperty(globalThis, bridge);
        const environment = server.environments.ssr!;
        if (!isRunnableDevEnvironment(environment)) {
          throw new Error("Expected a runnable SSR environment.");
        }
        const { content } = await environment.runner.import("/consumer.mjs");
        const listing = content.query("posts").select("value");
        await expect(listing.first()).rejects.toMatchObject({
          code: "validation-error",
          collection: "posts",
          path: ["value"],
          issues: [expect.objectContaining({ minimum: 10n })],
        });
        await writeFile(filename, JSON.stringify([{ id: "one", value: "20" }]));
        await vi.waitFor(
          async () => expect(await listing.first()).toEqual({ value: 20n }),
          watcherWait,
        );
        await writeFile(filename, JSON.stringify([{ id: "one", value: "3" }]));
        await vi.waitFor(
          () =>
            expect(listing.first()).rejects.toMatchObject({
              code: "validation-error",
              issues: [expect.objectContaining({ minimum: 10n })],
            }),
          watcherWait,
        );
        await writeFile(filename, JSON.stringify([{ id: "one", value: "30" }]));
        await vi.waitFor(
          async () => expect(await listing.first()).toEqual({ value: 30n }),
          watcherWait,
        );
      } finally {
        Reflect.set(globalThis, bridge, previous);
        await server?.close();
        await fixture.dispose();
      }
    });
    test(`${backend} serves current data, surfaces errors, and recovers without a restart`, async () => {
      const fixture = await projectFixture();
      const configName =
        backend === "generated" ? "content-query.config.mjs" : "content-query.config.mts";
      const configPath = path.join(fixture.root, configName);
      await rename(fixture.config, configPath);
      await writeFile(
        path.join(fixture.root, "consumer.mjs"),
        `export {content} from ${JSON.stringify(backend === "generated" ? "./.content-query/server.js" : "content-query:server")};`,
      );
      const server = await createServer({
        configFile: false,
        root: fixture.root,
        logLevel: "silent",
        plugins: [contentQuery({ backend })],
        server: devServer,
        optimizeDeps: { noDiscovery: true },
      });
      try {
        const { content } = await server.ssrLoadModule("/consumer.mjs");
        expect(await content.query("posts").select("title").first()).toEqual({
          title: "Getting started",
        });
        await writeFile(
          fixture.postPath,
          "---\ntitle: Updated\nauthorId: ada\ndate: 2026-01-02\n---\n## Updated\n",
        );
        await vi.waitFor(
          async () =>
            expect(await content.query("posts").select("title").first()).toEqual({
              title: "Updated",
            }),
          watcherWait,
        );
        await writeFile(fixture.postPath, "---\ntitle: false\n---\n");
        await vi.waitFor(
          async () =>
            expect(content.query("posts").count()).rejects.toMatchObject({
              code: "validation-error",
            }),
          watcherWait,
        );
        await writeFile(
          fixture.postPath,
          "---\ntitle: Fixed\nauthorId: ada\ndate: 2026-01-03\n---\n## Fixed\n",
        );
        await vi.waitFor(
          async () =>
            expect(await content.query("posts").select("title").first()).toEqual({
              title: "Fixed",
            }),
          watcherWait,
        );
        expect((await content.render("posts", "getting-started")).headings[0].slug).toBe("fixed");
        await writeFile(
          configPath,
          (await readFile(configPath, "utf8")).replace(
            "data.title.toUpperCase()",
            '"Updated configuration"',
          ),
        );
        await vi.waitFor(
          async () =>
            expect(await content.query("posts").select("upper").first()).toEqual({
              upper: "Updated configuration",
            }),
          watcherWait,
        );
        const outputFiles = await readdir(path.join(fixture.root, ".content-query"));
        if (backend === "in-memory") {
          expect(outputFiles).toEqual(["types.d.ts"]);
        } else {
          expect(outputFiles.sort()).toEqual([
            "collections",
            "manifest.js",
            "package.json",
            "server.d.ts",
            "server.js",
            "types.d.ts",
          ]);
        }
        expect(
          await readFile(path.join(fixture.root, ".content-query/types.d.ts"), "utf8"),
        ).toContain(`typeof import("../${configName}").collections`);
      } finally {
        await server.close();
        await fixture.dispose();
      }
    });
    test(`${backend} bundles source-independent SSR output`, async () => {
      const fixture = await projectFixture();
      const entry = path.join(fixture.root, "consumer.mjs");
      await writeFile(entry, 'export {content} from "content-query:server";');
      try {
        await build({
          configFile: false,
          root: fixture.root,
          logLevel: "silent",
          plugins: [contentQuery({ backend })],
          ssr: { noExternal: ["content-query"] },
          build: {
            ssr: entry,
            outDir: "dist",
            rollupOptions: { output: { entryFileNames: "server.mjs" } },
          },
        });
        await rm(fixture.config);
        await rm(path.join(fixture.root, "content"), { recursive: true });
        await rm(path.join(fixture.root, ".content-query"), { recursive: true, force: true });
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `const {content}=await import(${JSON.stringify(pathToFileURL(path.join(fixture.root, "dist/server.mjs")).href)}); console.log(await content.query("posts").count());console.log((await content.render("posts","getting-started")).headings.length);`,
          ],
          { cwd: fixture.root },
        );
        expect(stdout.trim().split("\n")).toEqual(["1", "2"]);
        const files = await readdir(path.join(fixture.root, "dist"));
        expect(files.some((filename) => filename.includes("markdown"))).toBe(false);
      } finally {
        await fixture.dispose();
      }
    });
  }
  for (const source of [
    "content-query:server",
    "./.content-query/server.js",
    "content-query/query",
    "content-query/computed",
    "./content-query.config.ts",
    "./content-query.config.mts",
    "./content-query.config.cts",
    "./content-query.config.js",
    "./content-query.config.mjs",
    "./content-query.config.cjs",
  ]) {
    test(`rejects transitive client access to ${source}`, async () => {
      const fixture = await projectFixture();
      if (source.startsWith("./content-query.config.") && !source.endsWith(".ts")) {
        await rm(fixture.config);
        await writeFile(
          path.resolve(fixture.root, source),
          /\.(?:cjs|cts)$/.test(source)
            ? "module.exports.collections = {};"
            : "export const collections = {};",
        );
      }
      await writeFile(
        path.join(fixture.root, "shared.mjs"),
        `export * from ${JSON.stringify(source)};`,
      );
      await writeFile(
        path.join(fixture.root, "client.mjs"),
        'import * as shared from "./shared.mjs";console.log(shared);',
      );
      try {
        await expect(
          build({
            configFile: false,
            root: fixture.root,
            logLevel: "silent",
            plugins: [contentQuery()],
            build: { rollupOptions: { input: path.join(fixture.root, "client.mjs") } },
          }),
        ).rejects.toThrow(/Server-only/);
      } finally {
        await fixture.dispose();
      }
    });
  }
});
