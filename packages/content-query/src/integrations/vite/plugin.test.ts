import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build, createServer } from "vite-plus";
import { describe, expect, test, vi } from "vite-plus/test";
import { projectFixture } from "../../../tests/helpers/project.ts";
import { contentQuery } from "./plugin.ts";

const execute = promisify(execFile);
vi.setConfig({ testTimeout: 20_000 });

describe("Vite artifact watching", () => {
  test.each([".content-query", "generated[content]/bundle"])(
    "ignores %s artifacts while preserving application watching and configured ignores",
    async (outDir) => {
      const fixture = await projectFixture(true);
      const server = await createServer({
        root: fixture.root,
        configFile: false,
        plugins: [contentQuery({ outDir })],
        server: { watch: { ignored: /application-ignored/ } },
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
          plugins: [contentQuery({ backend })],
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
        const outputs = Array.isArray(result) ? result : [result];
        const chunks = outputs.flatMap((output) =>
          "output" in output ? output.output.filter((chunk) => chunk.type === "chunk") : [],
        );
        const payloads = chunks.filter((chunk) => chunk.code.includes("Payload marker "));
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
        const entry = chunks.find((chunk) => chunk.isEntry)!;
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
console.log(JSON.stringify({count: await content.query("posts").count(), bodies}));
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
