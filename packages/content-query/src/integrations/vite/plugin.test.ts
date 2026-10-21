import { execFile } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build, createServer } from "vite-plus";
import { describe, expect, test, vi } from "vite-plus/test";
import { projectFixture } from "../../../tests/helpers/project.ts";
import * as preparation from "../../preparation/build.ts";
import { contentQuery } from "./plugin.ts";
import * as virtualModules from "./modules.ts";

const execute = promisify(execFile);
vi.setConfig({ testTimeout: 20_000 });

/** Creates a manually released gate for real Vite initialization and shutdown tests. */
function preparationGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
}

describe("Vite artifact watching", () => {
  test.each([".content-query", "generated[content]/bundle"])(
    "ignores %s artifacts while preserving application watching and configured ignores",
    async (outDir) => {
      const fixture = await projectFixture(true);
      const server = await createServer({
        root: fixture.root,
        configFile: false,
        plugins: [contentQuery({ backend: "generated", outDir })],
        server: { middlewareMode: true, watch: { ignored: /application-ignored/ } },
        optimizeDeps: { noDiscovery: true },
      });
      const seen: string[] = [];
      server.watcher.on("all", (_event, filename) => seen.push(filename));
      try {
        await vi.waitFor(() => {
          expect(Object.keys(server.watcher.getWatched())).toContain(fixture.root);
        });
        const generated = path.join(fixture.root, outDir, "watcher-probe.js");
        const application = path.join(fixture.root, "application-probe.ts");
        const ignored = path.join(fixture.root, "application-ignored.ts");
        await writeFile(generated, "export default 1;");
        await writeFile(ignored, "export default 1;");
        await writeFile(application, "export default 1;");
        await vi.waitFor(() => expect(seen).toContain(application));
        expect(seen).not.toContain(generated);
        expect(seen).not.toContain(ignored);
        expect(Object.keys(server.watcher.getWatched())).not.toContain(
          path.join(fixture.root, outDir),
        );
      } finally {
        await server.close();
        await fixture.dispose();
      }
    },
  );
});

describe("Vite content preparation", () => {
  test("overlaps later server hooks while preparing content before initialization completes", async () => {
    const fixture = await projectFixture();
    const key = `content-query-preparation:${fixture.root}`;
    const release = preparationGate();
    const events: string[] = [];
    Reflect.set(process, Symbol.for(key), { release: release.promise, events });
    // Release an old sequential implementation so a failure does not leave createServer hanging.
    const timeout = setTimeout(() => release.resolve(), 1_000);
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      await writeFile(
        fixture.config,
        `import {defineCollection} from "content-query";
const barrier = process[Symbol.for(${JSON.stringify(key)})];
export const collections = {posts: defineCollection({loader: {name: "fixture", async load({store}) {
  await barrier.release;
  store.set({id: "ready", data: {title: "Ready"}});
  barrier.events.push("prepared");
}}})};`,
      );
      server = await createServer({
        root: fixture.root,
        configFile: false,
        plugins: [
          contentQuery(),
          {
            name: "fixture:configure",
            configureServer() {
              events.push("configured");
              release.resolve();
            },
          },
        ],
        server: { middlewareMode: true, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true },
      });
      expect(events).toEqual(["configured", "prepared"]);
      const runtime = await server.ssrLoadModule("content-query:server");
      expect(await runtime.content.count("posts")).toBe(1);
    } finally {
      clearTimeout(timeout);
      release.resolve();
      await server?.close();
      Reflect.deleteProperty(process, Symbol.for(key));
      await fixture.dispose();
    }
  });

  test("disposes preparation when a server closes before listening", async () => {
    const fixture = await projectFixture();
    const key = `content-query-closing:${fixture.root}`;
    const started = preparationGate();
    const release = preparationGate();
    Reflect.set(process, Symbol.for(key), { started: started.resolve, release: release.promise });
    const original = preparation.buildAtRoot;
    const disposed = vi.fn<() => Promise<void>>();
    const build = vi.spyOn(preparation, "buildAtRoot").mockImplementation(async (...arguments_) => {
      const session = await original(...arguments_);
      session.dispose = disposed.mockImplementation(session.dispose.bind(session));
      return session;
    });
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      await writeFile(
        fixture.config,
        `import {defineCollection} from "content-query";
const barrier = process[Symbol.for(${JSON.stringify(key)})];
export const collections = {posts: defineCollection({loader: {name: "fixture", async load({store}) {
  barrier.started();
  await barrier.release;
  store.set({id: "ready", data: {title: "Ready"}});
}}})};`,
      );
      server = await createServer({
        root: fixture.root,
        configFile: false,
        plugins: [contentQuery()],
        server: { ws: false, watch: null },
        optimizeDeps: { noDiscovery: true },
      });
      await started.promise;
      const closing = server.close();
      release.resolve();
      await closing;
      expect(disposed).toHaveBeenCalled();
    } finally {
      release.resolve();
      await server?.close();
      build.mockRestore();
      Reflect.deleteProperty(process, Symbol.for(key));
      await fixture.dispose();
    }
  });

  test("reports preparation failure before server initialization completes", async () => {
    const fixture = await projectFixture();
    try {
      await rm(fixture.config);
      await expect(
        createServer({
          root: fixture.root,
          configFile: false,
          plugins: [contentQuery()],
          server: { middlewareMode: true, ws: false, watch: null },
          optimizeDeps: { noDiscovery: true },
        }),
      ).rejects.toThrow("content-query.config");
    } finally {
      await fixture.dispose();
    }
  });

  test("serializes each development revision once across concurrent delivery and startup", async () => {
    const fixture = await projectFixture();
    const original = virtualModules.preparedModules;
    const revisions: unknown[] = [];
    const prepared = vi.spyOn(virtualModules, "preparedModules").mockImplementation((state) => {
      revisions.push(state.revision);
      return original(state);
    });
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      await writeFile(
        fixture.config,
        `import {defineCollection} from "content-query";
export const collections = {posts: defineCollection({loader: {name: "fixture", async load({store}) {
  for (let index = 0; index < 64; index++) {
    store.set({id: String(index), data: {title: "Article " + index}, body: "Body " + index});
  }
}}})};`,
      );
      server = await createServer({
        root: fixture.root,
        configFile: false,
        plugins: [contentQuery()],
        server: { middlewareMode: true, ws: false },
        optimizeDeps: { noDiscovery: true },
      });
      // A delayed filesystem notification can legitimately prepare a replacement revision.
      expect(revisions.length).toBeGreaterThan(0);
      expect(revisions).not.toContain(undefined);
      expect(new Set(revisions).size).toBe(revisions.length);
    } finally {
      prepared.mockRestore();
      await server?.close();
      await fixture.dispose();
    }
  });

  test("does not load or prepare server content for a client-only production graph", async () => {
    const fixture = await projectFixture();
    try {
      await rm(fixture.config);
      await writeFile(
        path.join(fixture.root, "index.html"),
        '<script type="module" src="/main.js"></script>',
      );
      await writeFile(
        path.join(fixture.root, "main.js"),
        'document.body.textContent = "Client application";',
      );
      await expect(
        build({
          root: fixture.root,
          configFile: false,
          plugins: [contentQuery()],
          build: { write: false, minify: false },
          logLevel: "silent",
        }),
      ).resolves.toBeDefined();
    } finally {
      await fixture.dispose();
    }
  });

  test.each([
    { backend: "default", customSplitting: false, padding: 0 },
    { backend: "generated", customSplitting: false, padding: 0 },
    { backend: "in-memory", customSplitting: false, padding: 0 },
    { backend: "generated", customSplitting: true, padding: 0 },
    { backend: "generated", customSplitting: false, padding: 16_000 },
  ] as const)(
    "keeps payload chunks lazy with $backend, custom splitting=$customSplitting, padding=$padding",
    async ({ backend, customSplitting, padding }) => {
      const fixture = await projectFixture();
      try {
        await writeFile(
          fixture.config,
          `import {defineCollection} from "content-query";
export const collections = {posts: defineCollection({loader: {name: "fixture", async load({store}) {
  for (let index = 0; index < 64; index++) {
    store.set({id: String(index), data: {title: "Article " + index}, body: "Payload marker " + index + "x".repeat(${padding})});
  }
  store.set({id: "__proto__", data: {title: "Special entry"}, body: "Special payload"});
}}})};`,
        );
        const input = path.join(fixture.root, "consumer.js");
        await writeFile(
          input,
          backend === "generated"
            ? 'export {content} from "./.content-query/server.js";'
            : 'export {content} from "content-query:server";',
        );
        const outDir = path.join(fixture.root, "bundle");
        const result = await build({
          root: fixture.root,
          configFile: false,
          plugins: [contentQuery(backend === "default" ? undefined : { backend })],
          build: {
            ssr: true,
            outDir,
            minify: false,
            rollupOptions: {
              input,
              preserveEntrySignatures: "strict",
              ...(customSplitting
                ? {
                    output: {
                      codeSplitting: { groups: [] },
                      chunkFileNames: "custom/[name]-[hash].js",
                    },
                  }
                : {}),
            },
          },
          logLevel: "silent",
        });
        if (backend === "default") {
          expect(await readdir(path.join(fixture.root, ".content-query"))).toEqual(["types.d.ts"]);
        }
        const outputs = Array.isArray(result) ? result : [result];
        const chunks = outputs.flatMap((output) =>
          "output" in output ? output.output.filter((chunk) => chunk.type === "chunk") : [],
        );
        const entry = chunks.find((chunk) => chunk.isEntry)!;
        const payloads = chunks.filter((chunk) => entry.dynamicImports.includes(chunk.fileName));
        if (!padding) {
          expect(chunks.length).toBeLessThan(20);
        }
        if (customSplitting) {
          expect(payloads).toHaveLength(1);
          expect(payloads[0]!.fileName).toMatch(/^custom\//);
        } else if (padding) {
          expect(payloads.length).toBeGreaterThan(1);
          expect(payloads.length).toBeLessThan(64);
        } else {
          expect(payloads).toHaveLength(1);
        }
        expect(entry.code).not.toContain("Payload marker ");
        expect(entry.imports).not.toContain(payloads[0]!.fileName);
        expect(entry.dynamicImports).toContain(payloads[0]!.fileName);
        await rm(fixture.config);
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
const {content} = await import(${JSON.stringify(pathToFileURL(path.join(outDir, entry.fileName)).href)});
const ids = ["0", "63", "__proto__"];
const bodies = await Promise.all(ids.map(async id => { const body = await content.readBody("posts", id); return {prefix: body.slice(0, 16), length: body.length}; }));
console.log(JSON.stringify({count: await content.select().from("posts").count(), bodies}));
`,
          ],
          { cwd: fixture.root },
        );
        expect(JSON.parse(stdout)).toEqual({
          count: 65,
          bodies: [
            {
              prefix: `Payload marker 0${"x".repeat(padding)}`.slice(0, 16),
              length: "Payload marker 0".length + padding,
            },
            {
              prefix: `Payload marker 63${"x".repeat(padding)}`.slice(0, 16),
              length: "Payload marker 63".length + padding,
            },
            { prefix: "Special payload", length: 15 },
          ],
        });
      } finally {
        await fixture.dispose();
      }
    },
  );
});
