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
  await mkdir(path.join(root, "node_modules"));
  const dependencies = fileURLToPath(
    new URL("../../../examples/react-router-mdx/node_modules", import.meta.url),
  );
  for (const name of await readdir(dependencies)) {
    if (!name.startsWith(".")) {
      await symlink(path.join(dependencies, name), path.join(root, "node_modules", name), "dir");
    }
  }
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
  test("preserves host refresh and overlays while versioning changed browser document references", async () => {
    const host = await fixture();
    const core = contentQuery();
    const analyzed = vi.fn();
    const events: ContentSourceEvent[] = [];
    core.api.subscribe((event) => events.push(event));
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
    const send = vi.spyOn(server.ws, "send");
    try {
      const initial = await (await consumer(server)).loadMdxDocument("docs", "first");
      expect(analyzed).toHaveBeenCalledOnce();
      const source = path.join(host.root, "content/first.mdx");
      await writeFile(source, "---\ntitle: Edited\n---\n# Updated prose");
      let next = initial;
      await vi.waitFor(
        async () => {
          const module = await consumer(server);
          next = await module.loadMdxDocument("docs", "first");
          expect(next.url).not.toBe(initial.url);
          expect((await module.renderMdx("docs", "first")).html).toContain("Updated prose");
        },
        { timeout: 8000 },
      );
      expect(events.some((event) => event.type === "ready")).toBe(true);
      const environment = server.environments.ssr!;
      if (!isRunnableDevEnvironment(environment)) {
        throw new Error("Expected SSR runner");
      }
      const transformed = await server.transformRequest(next.url);
      expect(transformed?.code).toContain("Updated prose");
      await writeFile(source, "---\ntitle: false\n---\n# Invalid");
      await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true), {
        timeout: 8000,
      });
      await expect(core.api.prepare()).rejects.toThrow();
      const payloads: unknown[] = send.mock.calls.map((arguments_) => arguments_[0]);
      expect(payloads).toContainEqual(expect.objectContaining({ type: "error" }));
      expect(payloads).not.toContainEqual(expect.objectContaining({ type: "full-reload" }));
    } finally {
      send.mockRestore();
      await server.close();
      await host.dispose();
    }
  });

  test("resolves external package widgets separately for server and browser and shares browser entries", async () => {
    const host = await fixture();
    const dependency = path.join(host.root, "node_modules/conditional-widget");
    await mkdir(dependency);
    await writeFile(
      path.join(dependency, "package.json"),
      JSON.stringify({
        name: "conditional-widget",
        type: "module",
        exports: {
          ".": { browser: "./browser.js", default: "./node.js" },
          "./only": { browser: "./only-browser.js", default: "./only-node.js" },
        },
      }),
    );
    for (const environment of ["node", "browser"]) {
      await writeFile(
        path.join(dependency, `${environment}.js`),
        `globalThis.__cq_widget_environment=${JSON.stringify(`${environment.toUpperCase()}_WIDGET_SENTINEL`)};import {createElement} from "react";export function Widget({label}){return createElement("button",null,label)}`,
      );
    }
    await writeFile(
      path.join(dependency, "only-node.js"),
      'throw new Error("ONLY_NODE_MUST_NOT_EVALUATE");export default function BrowserOnly(){}',
    );
    await writeFile(
      path.join(dependency, "only-browser.js"),
      'import {createElement} from "react";export default function BrowserOnly(){return createElement("span",null,"Browser only")}',
    );
    await mkdir(path.join(host.root, "content/nested"));
    for (const name of ["first", "nested/second"]) {
      await writeFile(
        path.join(host.root, `content/${name}.mdx`),
        `---\ntitle: ${name}\n---\nimport {Widget} from "conditional-widget";\nimport BrowserOnly from "conditional-widget/only";\n\n<Widget client:load label="Package widget" />\n\n<BrowserOnly client:only />`,
      );
    }
    const core = contentQuery();
    const server = await createServer({
      configFile: false,
      root: host.root,
      logLevel: "silent",
      plugins: [core, contentQueryMdx({ rendering: "both", highlight: false })],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    let widgetId: string;
    try {
      const module = await consumer(server);
      const rendered = await module.renderMdx("docs", "first");
      expect(rendered.html).toContain("Package widget");
      expect(rendered.html).not.toContain("ONLY_NODE_MUST_NOT_EVALUATE");
      widgetId = rendered.html.match(/data-cq-island="([^"]+)"/)![1]!;
      const assets = await module.getMdxAssets();
      const entry = await server.transformRequest(
        assets.island(widgetId).url.replace("/@id/__x00__", "\0"),
      );
      expect(entry?.code).toContain("conditional-widget/browser.js");
      expect(entry?.code).not.toContain("conditional-widget/node.js");
    } finally {
      await server.close();
    }
    await writeFile(
      path.join(host.root, "browser.js"),
      'export {MdxDocument} from "@content-query/mdx/react";',
    );
    try {
      const builder = await createBuilder({
        configFile: false,
        root: host.root,
        logLevel: "silent",
        plugins: [contentQuery(), contentQueryMdx({ rendering: "both", highlight: false })],
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
      const manifest = JSON.parse(
        await readFile(path.join(host.root, ".content-query/mdx/manifest.json"), "utf8"),
      ) as MdxAssetManifest;
      expect(manifest.islands[widgetId!]).toBeDefined();
      // Two import locations have stable identities, but share one entry per browser export.
      expect(new Set(Object.values(manifest.islands).map((entry) => entry.url)).size).toBe(2);
      const files = await readdir(path.join(host.root, "dist/client/assets"));
      const scripts = (
        await Promise.all(
          files
            .filter((file) => file.endsWith(".js"))
            .map((file) => readFile(path.join(host.root, "dist/client/assets", file), "utf8")),
        )
      ).join("\n");
      expect(scripts).toContain("BROWSER_WIDGET_SENTINEL");
      expect(scripts).not.toContain("NODE_WIDGET_SENTINEL");
      expect(scripts).not.toContain("ONLY_NODE_MUST_NOT_EVALUATE");
      const module = await import(
        /* @vite-ignore */ pathToFileURL(path.join(host.root, "dist/server/consumer.js")).href
      );
      const rendered = await module.renderMdx("docs", "first");
      expect(rendered.html).toContain(`data-cq-island="${widgetId!}"`);
      expect(rendered.html).toContain("Package widget");
      expect((await module.loadMdx("docs", "first")).default).toBeTypeOf("function");
    } finally {
      await host.dispose();
    }
  }, 30_000);

  test("starts with invalid content, reports errors on load, and recovers without restarting", async () => {
    const host = await fixture();
    const source = path.join(host.root, "content/first.mdx");
    await writeFile(source, "---\ntitle: false\n---\n# Invalid");
    const core = contentQuery();
    const server = await createServer({
      configFile: false,
      root: host.root,
      logLevel: "silent",
      plugins: [core, contentQueryMdx({ highlight: false })],
      server: { host: "127.0.0.1", port: 0, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      await server.listen();
      await expect(core.api.prepare()).rejects.toThrow();
      await expect(consumer(server)).rejects.toThrow();
      await writeFile(source, "---\ntitle: Recovered\n---\n# Recovered");
      await vi.waitFor(
        async () => {
          const module = await consumer(server);
          expect((await module.renderMdx("docs", "first")).html).toContain("Recovered");
        },
        { timeout: 8000 },
      );
    } finally {
      await server.close();
      await host.dispose();
    }
  });

  test("leaves raw, URL, and ordinary MDX imports to Vite or another compiler", async () => {
    const host = await fixture();
    const source = await readFile(path.join(host.root, "content/first.mdx"), "utf8");
    const fallback = vi.fn((id: string) =>
      id.endsWith(".mdx") ? 'export default "other-mdx-compiler";' : undefined,
    );
    const server = await createServer({
      configFile: false,
      root: host.root,
      logLevel: "silent",
      plugins: [contentQuery(), contentQueryMdx(), { name: "other-mdx-compiler", load: fallback }],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const environment = server.environments.ssr!;
      if (!isRunnableDevEnvironment(environment)) {
        throw new Error("Expected SSR runner");
      }
      expect((await environment.runner.import("/content/first.mdx?raw")).default).toBe(source);
      expect((await environment.runner.import("/content/first.mdx?cq-mdx=react&raw")).default).toBe(
        source,
      );
      expect((await environment.runner.import("/content/first.mdx?url")).default).toContain(
        "/content/first.mdx",
      );
      expect((await environment.runner.import("/content/first.mdx")).default).toBe(
        "other-mdx-compiler",
      );
      expect((await (await consumer(server)).loadMdx("docs", "first")).headings).toHaveLength(1);
    } finally {
      await server.close();
      await host.dispose();
    }
  });

  test("retries failed compilation when a missing widget is created without changing MDX", async () => {
    const host = await fixture();
    const source = path.join(host.root, "content/first.mdx");
    const text =
      '---\ntitle: First\n---\nimport Widget from "../missing.js";\n\n<Widget client:load label="Recovered widget" />';
    await writeFile(source, text);
    const server = await createServer({
      configFile: false,
      root: host.root,
      logLevel: "silent",
      plugins: [contentQuery(), contentQueryMdx({ highlight: false })],
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      await expect((await consumer(server)).renderMdx("docs", "first")).rejects.toThrow();
      await writeFile(
        path.join(host.root, "missing.js"),
        await readFile(path.join(host.root, "widget.js"), "utf8"),
      );
      await vi.waitFor(
        async () =>
          expect((await (await consumer(server)).renderMdx("docs", "first")).html).toContain(
            "Recovered widget",
          ),
        { timeout: 8000 },
      );
      expect(await readFile(source, "utf8")).toBe(text);
    } finally {
      await server.close();
      await host.dispose();
    }
  });

  test("rejects relative deployment bases with an actionable SSR diagnostic", async () => {
    const host = await fixture();
    try {
      await expect(
        createServer({
          configFile: false,
          root: host.root,
          base: "./",
          logLevel: "silent",
          plugins: [contentQuery(), contentQueryMdx()],
          server: { middlewareMode: true, ws: false },
        }),
      ).rejects.toThrow(/absolute.*base/i);
    } finally {
      await host.dispose();
    }
  });

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
    await writeFile(path.join(host.root, "second.module.css"), ".secondNote{color:purple}");
    await writeFile(
      path.join(host.root, "second-note.js"),
      'import {createElement} from "react";import styles from "./second.module.css";export function Note(){return createElement("aside",{className:styles.secondNote},"Second static note")}',
    );
    await writeFile(
      path.join(host.root, "content/second.mdx"),
      '---\ntitle: Second\n---\nimport Widget from "../widget.js";\nimport {Note} from "../second-note.js";\n\n<Note />\n\n<Widget client:visible label="Second" />',
    );
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
        await readFile(path.join(host.root, ".content-query/mdx/manifest.json"), "utf8"),
      ) as MdxAssetManifest;
      expect(Object.keys(manifest.documents)).toHaveLength(4);
      expect(Object.values(manifest.documents).every((document) => !document.client)).toBe(true);
      expect(manifest.documents['["docs","first"]']?.css.length).toBeGreaterThan(0);
      expect(manifest.documents['["docs","third"]']?.css).toEqual([]);
      const secondStyles = manifest.documents['["docs","second"]']!.css;
      expect(secondStyles.length).toBeGreaterThan(0);
      expect(
        manifest.documents['["docs","first"]']!.css.every((style) => !secondStyles.includes(style)),
      ).toBe(true);
      await expect(
        readFile(path.join(host.root, "dist/client/.vite/content-query-mdx-manifest.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
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
        await readFile(path.join(host.root, ".content-query/mdx/manifest.json"), "utf8"),
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
