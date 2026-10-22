import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  build,
  createBuilder,
  createServer,
  isRunnableDevEnvironment,
  type ViteDevServer,
} from "vite-plus";
import { describe, expect, test, vi } from "vite-plus/test";
import { contentQuery } from "content-query/vite";
import type { ContentSourceEvent } from "content-query/build";
import type { MdxAssetManifest } from "./types.ts";
import { contentQueryMdx } from "./vite.ts";
import { createMdxAssets } from "./assets.ts";
import { pathToFileURL } from "node:url";

/** Creates a real host with local package resolution and no framework-specific rendering machinery. */
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "cq-mdx-vite-")));
  await symlink(
    fileURLToPath(new URL("../../../examples/react-router-mdx/node_modules", import.meta.url)),
    path.join(root, "node_modules"),
    "dir",
  );
  await mkdir(path.join(root, "content"));
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "content-query.config.ts"),
    `import {defineCollection} from "content-query";
import {schema} from "content-query/schema";
import {mdx} from "@content-query/mdx";
export const collections={docs:defineCollection({loader:mdx({base:"content"}),schema:schema.object({title:schema.string()})})};`,
  );
  await writeFile(
    path.join(root, "consumer.js"),
    `export {content} from "content-query:server";
export {loadMdx, loadMdxDocument, renderMdx, getMdxAssets} from "content-query:mdx:server";`,
  );
  await writeFile(
    path.join(root, "widget.js"),
    'import {createElement} from "react";export default function Widget({label}){return createElement("button",null,label)}',
  );
  await writeFile(
    path.join(root, "content/first.mdx"),
    '---\ntitle: First\n---\nimport Widget from "../widget.js";\n\n# First\n\n<Widget client:visible label="Shared widget" />',
  );
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

/** Accesses Vite's real SSR runner, including its invalidation and module caching behavior. */
async function consumer(server: ViteDevServer) {
  const environment = server.environments.ssr!;
  if (!isRunnableDevEnvironment(environment)) {
    throw new Error("Expected a runnable SSR environment.");
  }
  return environment.runner.import("/consumer.js");
}

describe("MDX Vite integration", () => {
  test("prepares metadata independently, lazily shares analysis, and publishes repeated edits and recovery", async () => {
    const host = await fixture();
    const core = contentQuery();
    const events: ContentSourceEvent[] = [];
    const unsubscribe = core.api.subscribe((event) => events.push(event));
    const analyzed = vi.fn();
    const server = await createServer({
      configFile: false,
      root: host.root,
      logLevel: "silent",
      plugins: [
        core,
        contentQueryMdx({ rendering: "both", highlight: false, remarkPlugins: [() => analyzed] }),
      ],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    const changed = path.join(host.root, "content/first.mdx");
    try {
      let module = await consumer(server);
      expect(await module.content.select("title").from("docs")).toEqual([{ title: "First" }]);
      expect(analyzed).not.toHaveBeenCalled();
      const initial = await core.api.prepare();
      expect(initial.entries).toEqual([{ collection: "docs", id: "first", filePath: changed }]);
      const first = await module.loadMdx("docs", "first");
      expect(first.headings).toEqual([{ depth: 1, slug: "first", text: "First" }]);
      const assets = await module.getMdxAssets();
      expect(assets.document("docs", "first").url).toContain("first.mdx?cq-mdx=react");
      expect((await module.renderMdx("docs", "first")).html).toContain(
        'data-cq-strategy="visible"',
      );
      expect(analyzed).toHaveBeenCalledOnce();
      await expect(module.loadMdx("docs", "missing")).rejects.toThrow("Unknown MDX document");
      for (const id of [
        "content-query:mdx:server",
        "\0content-query-mdx:server",
        "\0content-query-mdx:react",
        "\0content-query-mdx:islands",
        "\0content-query-mdx:assets",
      ]) {
        await expect(server.transformRequest(id)).rejects.toThrow(/server-only/i);
      }
      for (const title of ["Second", "Third"]) {
        await writeFile(changed, `---\ntitle: ${title}\n---\n# ${title}`);
        await vi.waitFor(
          async () => {
            module = await consumer(server);
            expect(await module.content.select("title").from("docs")).toEqual([{ title }]);
            expect((await module.loadMdx("docs", "first")).headings[0].text).toBe(title);
          },
          { timeout: 8000 },
        );
      }
      expect((await core.api.prepare()).revision).not.toBe(initial.revision);
      await writeFile(changed, "---\ntitle: false\n---\n# Invalid");
      await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true), {
        timeout: 8000,
      });
      await expect(core.api.prepare()).rejects.toThrow();
      await writeFile(changed, "---\ntitle: Recovered\n---\n# Recovered");
      await vi.waitFor(async () => expect((await core.api.prepare()).entries).toHaveLength(1), {
        timeout: 8000,
      });
      await writeFile(path.join(host.root, "content/added.mdx"), "---\ntitle: Added\n---\n# Added");
      await vi.waitFor(async () => expect((await core.api.prepare()).entries).toHaveLength(2), {
        timeout: 8000,
      });
      await rm(changed);
      await vi.waitFor(
        async () =>
          expect((await core.api.prepare()).entries.map((entry) => entry.id)).toEqual(["added"]),
        { timeout: 8000 },
      );
      const declarations = await readFile(
        path.join(host.root, ".content-query/mdx/types.d.ts"),
        "utf8",
      );
      expect(declarations).toContain('declare module "content-query:mdx:server"');
      expect(declarations).toContain("RenderMdxOptions");
      expect(declarations.match(/declare module /g)).toHaveLength(1);
      expect(await readFile(path.join(host.root, ".content-query/types.d.ts"), "utf8")).toContain(
        'declare module "content-query:server"',
      );
    } finally {
      unsubscribe();
      await server.close();
      await host.dispose();
    }
  }, 30_000);

  test("inherits the islands target through imported MDX and includes server-only component styles", async () => {
    const host = await fixture();
    await writeFile(
      path.join(host.root, "callout.js"),
      'import "./callout.css";import {createElement} from "react";export default function Callout(){return createElement("aside",null,"Static note")}',
    );
    await writeFile(path.join(host.root, "callout.css"), "aside{color:green}");
    await writeFile(
      path.join(host.root, "snippet.mdx"),
      'import Widget from "./widget.js";\n\n<Widget client:load label="Nested source" />',
    );
    await writeFile(
      path.join(host.root, "content/first.mdx"),
      '---\ntitle: First\n---\nimport Snippet from "../snippet.mdx";\nimport Callout from "../callout.js";\n\n# First\n\n<Callout />\n\n<Snippet />',
    );
    const server = await createServer({
      configFile: false,
      root: host.root,
      logLevel: "silent",
      plugins: [contentQuery(), contentQueryMdx()],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const module = await consumer(server);
      const rendered = await module.renderMdx("docs", "first");
      expect(rendered.html).toContain('data-cq-strategy="load"');
      expect(rendered.html).toContain("Static note");
      expect(rendered.styles).toContain("/callout.css?direct");
      const assets = await module.getMdxAssets();
      expect(() => assets.document("docs", "first")).toThrow("enable rendering");
      expect(() => assets.styles("docs", "missing")).toThrow("Unknown MDX document");
      expect(() => assets.island("missing")).toThrow("No browser entry");
      expect(
        server.environments.ssr!.moduleGraph.getModuleById(
          `${path.join(host.root, "content/first.mdx")}?cq-mdx=react`,
        )?.transformResult,
      ).toBeFalsy();
    } finally {
      await server.close();
      await host.dispose();
    }
  });

  test("emits shared widget entries without browser document modules in the default mode", async () => {
    const host = await fixture();
    await writeFile(
      path.join(host.root, "index.html"),
      '<script type="module" src="/browser.js"></script>',
    );
    await writeFile(
      path.join(host.root, "browser.js"),
      'import {mountIslands} from "@content-query/mdx/client";mountIslands();',
    );
    await writeFile(path.join(host.root, "note.module.css"), ".staticNote{color:rgb(10,20,30)}");
    await writeFile(
      path.join(host.root, "note.js"),
      'import {createElement} from "react";import styles from "./note.module.css";export default function Note(){return createElement("aside",{className:styles.staticNote},"Only on the server")}',
    );
    await writeFile(
      path.join(host.root, "content/first.mdx"),
      '---\ntitle: First\n---\nimport Widget from "../widget.js";\nimport Note from "../note.js";\n\n# Private prose first\n\n<Note />\n\n<Widget client:visible label="First" />',
    );
    for (const name of ["second", "third", "fourth"]) {
      await writeFile(
        path.join(host.root, `content/${name}.mdx`),
        `---\ntitle: ${name}\n---\nimport Widget from "../widget.js";\n\n# Private prose ${name}\n\n<Widget client:visible label="${name}" />`,
      );
    }
    const config = {
      configFile: false as const,
      root: host.root,
      logLevel: "silent" as const,
      base: "/guide/",
      plugins: () => [contentQuery(), contentQueryMdx({ highlight: false })],
    };
    try {
      await build({
        ...config,
        plugins: config.plugins(),
        build: { ssr: "consumer.js", outDir: "dist/server" },
      });
      expect(
        await readFile(path.join(host.root, ".content-query/mdx/styles.json"), "utf8"),
      ).toContain("note.module.css");
      await build({ ...config, plugins: config.plugins(), build: { outDir: "dist/client" } });
      const manifest = JSON.parse(
        await readFile(
          path.join(host.root, "dist/client/.vite/content-query-mdx-manifest.json"),
          "utf8",
        ),
      ) as MdxAssetManifest;
      expect(Object.keys(manifest.documents)).toHaveLength(4);
      expect(Object.values(manifest.documents).every((document) => !document.client)).toBe(true);
      expect(manifest.documents['["docs","first"]']?.css.length).toBeGreaterThan(0);
      expect(Object.values(manifest.islands)).toHaveLength(1);
      expect(Object.values(manifest.islands)[0]?.url).toMatch(/^\/guide\/assets\/mdx-widget-/);
      const files = await readdir(path.join(host.root, "dist/client/assets"));
      expect(files.some((name) => name.startsWith("mdx-document-"))).toBe(false);
      const browser = await Promise.all(
        files
          .filter((name) => name.endsWith(".js"))
          .map((name) => readFile(path.join(host.root, "dist/client/assets", name), "utf8")),
      );
      expect(browser.join("\n")).not.toContain("Private prose");
      expect(browser.join("\n")).not.toContain("Only on the server");
      const styles = await Promise.all(
        files
          .filter((name) => name.endsWith(".css"))
          .map((name) => readFile(path.join(host.root, "dist/client/assets", name), "utf8")),
      );
      expect(styles.join("\n")).toMatch(/staticNote[^}]+color:/);
      const module = await import(
        /* @vite-ignore */ pathToFileURL(path.join(host.root, "dist/server/consumer.js")).href
      );
      await expect(module.renderMdx("docs", "first")).rejects.toThrow(
        "Pass the production MDX asset manifest",
      );
      const rendered = await module.renderMdx("docs", "first", {
        assets: createMdxAssets(manifest),
      });
      expect(rendered.html).toContain('data-cq-strategy="visible"');
      expect(rendered.styles).toEqual(manifest.documents['["docs","first"]']!.css);
    } finally {
      await host.dispose();
    }
  }, 20_000);

  test("rejects missing host integration and unsupported emission modes", async () => {
    expect(() => contentQueryMdx({ rendering: "invalid" as "react" })).toThrow(
      "Invalid MDX rendering mode",
    );
    const host = await fixture();
    try {
      await expect(
        createServer({
          configFile: false,
          root: host.root,
          plugins: [contentQueryMdx()],
          logLevel: "silent",
          server: { middlewareMode: true, ws: false },
        }),
      ).rejects.toThrow("requires contentQuery()");
    } finally {
      await host.dispose();
    }
  });

  test("integrates CSS, static assets, and a production manifest with a client-first framework build", async () => {
    const host = await fixture();
    await writeFile(
      path.join(host.root, "browser.js"),
      'export {MdxDocument,MdxIslands} from "@content-query/mdx/react";',
    );
    await writeFile(path.join(host.root, "note.module.css"), ".note{color:green}");
    await writeFile(
      path.join(host.root, "diagram.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    await writeFile(
      path.join(host.root, "note.js"),
      'import {createElement} from "react";import styles from "./note.module.css";export function Note(){return createElement("aside",{className:styles.note},"Static note")}',
    );
    await writeFile(
      path.join(host.root, "content/first.mdx"),
      '---\ntitle: First\n---\nimport {Note} from "../note.js";\nimport diagram from "../diagram.svg";\n\n# First\n\n<Note />\n\n<img src={diagram} alt="Diagram" />',
    );
    try {
      const builder = await createBuilder({
        configFile: false,
        root: host.root,
        logLevel: "silent",
        plugins: [contentQuery(), contentQueryMdx({ rendering: "both", highlight: false })],
        build: { assetsInlineLimit: 0 },
        environments: {
          client: { build: { outDir: "dist/client", rolldownOptions: { input: "browser.js" } } },
          ssr: {
            build: { ssr: true, outDir: "dist/server", rolldownOptions: { input: "consumer.js" } },
          },
        },
        builder: {
          sharedPlugins: true,
          sharedConfigBuild: true,
          async buildApp(builder) {
            await builder.build(builder.environments.client!);
            await builder.build(builder.environments.ssr!);
          },
        },
      });
      await builder.buildApp();
      await expect(readdir(path.join(host.root, ".content-query-mdx"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const manifest = JSON.parse(
        await readFile(
          path.join(host.root, "dist/client/.vite/content-query-mdx-manifest.json"),
          "utf8",
        ),
      ) as MdxAssetManifest;
      expect(manifest.documents['["docs","first"]']!.css.length).toBeGreaterThan(0);
      expect(manifest.assets).toHaveLength(1);
      await readFile(path.join(host.root, "dist/client", manifest.assets[0]!));
      await rm(path.join(host.root, "content"), { recursive: true });
      await rm(path.join(host.root, "content-query.config.ts"));
      await rm(path.join(host.root, ".content-query"), { recursive: true });
      const module = await import(
        /* @vite-ignore */ pathToFileURL(path.join(host.root, "dist/server/consumer.js")).href
      );
      const assets = await module.getMdxAssets();
      expect(assets.document("docs", "first")).toEqual(
        manifest.documents['["docs","first"]']!.client,
      );
      expect(await module.loadMdxDocument("docs", "first")).toEqual(
        assets.document("docs", "first"),
      );
      const rendered = await module.renderMdx("docs", "first");
      expect(rendered.html).toContain("Static note");
      expect(rendered.styles).toEqual(manifest.documents['["docs","first"]']!.css);
      expect(
        (await module.renderMdx("docs", "first", { assets: { ...assets, styles: () => [] } }))
          .styles,
      ).toEqual([]);
    } finally {
      await host.dispose();
    }
  }, 20_000);
});
