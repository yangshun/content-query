import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite-plus";
import type { ContentQueryPluginApi } from "content-query/vite";
import type { ContentSourceSnapshot } from "content-query/build";
import {
  analyzeMdx,
  compileAnalysis,
  type MdxAnalysis,
  type MdxCompileOptions,
} from "./compiler.ts";
import {
  documentKey,
  type MdxAssetManifest,
  type MdxAssets,
  type MdxClientReference,
} from "./types.ts";

const prefix = "\0content-query-mdx:";
const widgetPrefix = `${prefix}widget:`;
const onlyPrefix = `${prefix}only:`;
const serverId = `${prefix}server`;
const reactId = `${prefix}react`;
const islandsId = `${prefix}islands`;
const assetsId = `${prefix}assets`;
const stylesId = `${prefix}styles`;
const probeId = `${prefix}style-probe`;
const probeEnvironment = "content_query_mdx";
const bridgeSymbol = Symbol.for("content-query-mdx.dev-assets");
type BridgeGlobal = typeof globalThis & {
  [bridgeSymbol]?: Map<string, () => Promise<MdxAssets>>;
};
type Entry = { collection: string; id: string; filePath: string };
type Widget = { id: string; module: string; imported: string };
type OutputChunk = { imports: string[]; viteMetadata?: { importedCss: Set<string> } };

/** Vite owns asset references and environments; the shared compiler retains ordinary module imports. */
export type ContentQueryMdxOptions = Pick<
  MdxCompileOptions,
  "remarkPlugins" | "rehypePlugins" | "highlight"
> & {
  rendering?: "islands" | "react" | "both";
};

/** Normalizes source module identities independently of operating-system path separators. */
function normalize(filename: string): string {
  return filename.replaceAll("\\", "/");
}

/** Selects a default, named, or namespace-member export without evaluating the source module. */
function exported(imported: string): string {
  return imported
    .split(".")
    .map((part) => `[${JSON.stringify(part)}]`)
    .join("");
}

/** Integrates optional MDX with the existing content session and application-owned Vite SSR builds. */
export function contentQueryMdx(options: ContentQueryMdxOptions = {}): Plugin {
  const rendering = options.rendering ?? "islands";
  if (!["islands", "react", "both"].includes(rendering)) {
    throw new TypeError("Invalid MDX rendering mode.");
  }
  let config: ResolvedConfig;
  let server: ViteDevServer | undefined;
  let content: ContentQueryPluginApi;
  let unsubscribe: (() => void) | undefined;
  let snapshot: ContentSourceSnapshot | undefined;
  let entries: Entry[] = [];
  let entriesByKey = new Map<string, Entry>();
  const analyses = new Map<
    string,
    {
      source: string;
      value: Promise<MdxAnalysis>;
      compiled: Map<string, Promise<Awaited<ReturnType<typeof compileAnalysis>>>>;
    }
  >();
  const widgets = new Map<string, Widget>();
  const emittedWidgets = new Map<string, string>();
  const emittedDocuments = new Map<string, string>();
  let styleEntry: string | undefined;
  let serverStyles: Record<string, string[]> = {};
  let serverAssets: string[] = [];
  let appBuild = false;
  const bridgeKey = randomUUID();

  /** Locates MDX-owned declarations and build intermediates inside the shared generated directory. */
  function directory(): string {
    return path.join(config.root, ".content-query", "mdx");
  }

  /** Reuses prepared identities; no companion directory scan or second content preparation is needed. */
  async function prepare(): Promise<Entry[]> {
    const next = await content.prepare();
    if (snapshot?.revision !== next.revision) {
      snapshot = next;
      entries = next.entries.flatMap((entry) =>
        entry.filePath?.toLowerCase().endsWith(".mdx")
          ? [{ ...entry, filePath: normalize(path.resolve(config.root, entry.filePath)) }]
          : [],
      );
      entriesByKey = new Map(
        entries.map((entry) => [documentKey(entry.collection, entry.id), entry]),
      );
    }
    return entries;
  }

  /** Parses each captured file revision once and keeps compiled target promises independent. */
  async function analysis(filename: string) {
    const source = await readFile(filename, "utf8");
    let cached = analyses.get(filename);
    if (!cached || cached.source !== source) {
      cached = {
        source,
        value: analyzeMdx({ path: filename, value: source }, options),
        compiled: new Map(),
      };
      analyses.set(filename, cached);
    }
    return cached;
  }

  /** Converts a source identity to a development URL while honoring Vite's configured base. */
  function devUrl(id: string): string {
    const url = id.startsWith("\0")
      ? `/@id/__x00__${id.slice(1)}`
      : id.startsWith(`${normalize(config.root)}/`)
        ? `/${id.slice(normalize(config.root).length + 1)}`
        : `/@fs/${id}`;
    return `${config.base.replace(/\/$/, "")}${url}`;
  }

  /** Reads CSS reached by server modules, including styles imported through static components. */
  function collectStyles(roots: string[], imported: (id: string) => readonly string[]): string[] {
    const result = new Set<string>();
    const seen = new Set<string>();
    const pending = [...roots].reverse();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      if (
        /\.(?:css|scss|sass|less|styl)(?:\?|$)/.test(id) &&
        !/[?&](?:inline|raw|url)(?:[=&]|$)/.test(id)
      ) {
        result.add(id);
      } else {
        pending.push(...[...imported(id)].reverse());
      }
    }
    return [...result];
  }

  /** Resolves development references against the live graph, including modules loaded during rendering. */
  async function developmentAssets(): Promise<MdxAssets> {
    await prepare();
    /** Resolves a selected source without scanning or compiling unrelated document bodies. */
    function entryFor(collection: string, id: string): Entry {
      const entry = entriesByKey.get(documentKey(collection, id));
      if (!entry) {
        throw new Error(`Unknown MDX document ${documentKey(collection, id)}.`);
      }
      return entry;
    }
    /** Collects styles only after the selected server module has entered Vite's graph. */
    function styles(collection: string, id: string): string[] {
      const entry = entryFor(collection, id);
      const graph = server!.environments.ssr?.moduleGraph ?? server!.moduleGraph;
      return collectStyles(
        [`${entry.filePath}?cq-mdx=react`, `${entry.filePath}?cq-mdx=islands`],
        (id) =>
          [...(graph.getModuleById(id)?.importedModules ?? [])]
            .map((module) => module.id!)
            .filter(Boolean),
      ).map((id) => `${devUrl(id.split("?")[0]!)}?direct`);
    }
    return {
      styles,
      document(collection, id) {
        const entry = entryFor(collection, id);
        if (rendering === "islands") {
          throw new Error("No browser document entry; enable rendering: react or both.");
        }
        return { url: devUrl(`${entry.filePath}?cq-mdx=react`), css: styles(collection, id) };
      },
      island(id) {
        if (!widgets.has(id)) {
          throw new Error(`No browser entry for MDX widget ${id}.`);
        }
        return { url: devUrl(`${widgetPrefix}${id}`), css: [] };
      },
    };
  }

  /** Writes project-bound virtual types without adding a runtime import of collection configuration. */
  async function writeTypes(): Promise<void> {
    const code = `declare module "content-query:mdx:server" {
  /** Island rendering options. Vite resolves assets automatically unless explicitly overridden. */
  export type RenderMdxOptions = Omit<import("@content-query/mdx/react/server").RenderMdxOptions, "assets"> & { assets?: import("@content-query/mdx").MdxAssets };
  /** Loads a selected ordinary MDX module for server rendering in the application's React tree. */
  export function loadMdx(collection: import("content-query:server").CollectionKey, id: string): Promise<import("@content-query/mdx").MdxModule>;
  /** Prepares the selected SSR module and returns its serializable browser reference. */
  export function loadMdxDocument(collection: import("content-query:server").CollectionKey, id: string): Promise<import("@content-query/mdx").MdxClientReference>;
  /** Renders a selected document as static prose and independently hydrated React islands. */
  export function renderMdx(collection: import("content-query:server").CollectionKey, id: string, options?: RenderMdxOptions): Promise<{html: string; headings: import("content-query").ContentHeading[]; styles: string[]}>;
  /** Resolves the complete server-only asset manifest for advanced host integrations. */
  export function getMdxAssets(): Promise<import("@content-query/mdx").MdxAssets>;
}
`;
    await mkdir(directory(), { recursive: true });
    const filename = path.join(directory(), "types.d.ts");
    if ((await readFile(filename, "utf8").catch(() => "")) !== code) {
      await writeFile(filename, code);
    }
  }

  return {
    name: "content-query-mdx",
    enforce: "pre",
    sharedDuringBuild: true,
    config: {
      order: "post",
      handler(user, environment) {
        appBuild = environment.command === "build" && Boolean(user.builder?.buildApp);
        return {
          ...(user.build?.ssr ? { build: { emitAssets: true } } : {}),
          ...(appBuild
            ? {
                environments: {
                  [probeEnvironment]: {
                    consumer: "server" as const,
                    resolve: user.environments?.ssr?.resolve,
                    build: {
                      ssr: true,
                      emitAssets: true,
                      outDir: ".content-query/mdx/server",
                      emptyOutDir: true,
                      manifest: false,
                      rolldownOptions: {
                        input: probeId,
                        preserveEntrySignatures: "strict" as const,
                      },
                    },
                  },
                },
              }
            : {}),
        };
      },
    },
    buildApp: {
      order: "pre",
      async handler(builder) {
        if (appBuild) {
          await builder.build(builder.environments[probeEnvironment]!);
        }
      },
    },
    configResolved(resolved) {
      config = resolved;
      const core = resolved.plugins.find((plugin) => plugin.name === "content-query")?.api as
        | ContentQueryPluginApi
        | undefined;
      if (!core?.prepare || !core.subscribe) {
        throw new Error("contentQueryMdx() requires contentQuery() with source integration hooks.");
      }
      content = core;
      unsubscribe = core.subscribe(() => {
        snapshot = undefined;
        analyses.clear();
        if (server) {
          for (const environment of Object.values(server.environments)) {
            for (const module of environment.moduleGraph.idToModuleMap.values()) {
              if (module.id?.startsWith(prefix)) {
                environment.moduleGraph.invalidateModule(module);
              }
            }
          }
          server.ws.send({ type: "full-reload" });
        }
      });
    },
    configureServer(viteServer) {
      server = viteServer;
      const global = globalThis as BridgeGlobal;
      global[bridgeSymbol] ??= new Map();
      global[bridgeSymbol].set(bridgeKey, developmentAssets);
    },
    async buildStart() {
      await prepare();
      await writeTypes();
      if (config.command !== "build" || this.environment.config.consumer !== "client") {
        return;
      }
      serverStyles = JSON.parse(
        await readFile(path.join(directory(), "styles.json"), "utf8").catch(() => "{}"),
      ) as Record<string, string[]>;
      serverAssets = JSON.parse(
        await readFile(path.join(directory(), "assets.json"), "utf8").catch(() => "[]"),
      ) as string[];
      const visited = new Set<string>();
      /** Discovers widgets in collection entries and imported MDX without compiling their bodies. */
      const discover = async (filename: string): Promise<void> => {
        if (visited.has(filename)) {
          return;
        }
        visited.add(filename);
        const parsed = await (await analysis(filename)).value;
        for (const reference of parsed.islands) {
          const resolved = await this.resolve(reference.source, filename, { skipSelf: true });
          if (!resolved || resolved.external) {
            this.error(`Cannot resolve MDX widget ${reference.source} from ${filename}.`);
          }
          const module = normalize(resolved.id);
          const id = createHash("sha256")
            .update(`${normalize(path.relative(config.root, module))}:${reference.imported}`)
            .digest("hex")
            .slice(0, 20);
          widgets.set(id, { id, module, imported: reference.imported });
        }
        for (const node of parsed.tree.children) {
          if (node.type === "mdxjsEsm") {
            for (const statement of node.data?.estree?.body ?? []) {
              if (
                statement.type === "ImportDeclaration" &&
                String(statement.source.value).endsWith(".mdx")
              ) {
                const resolved = await this.resolve(String(statement.source.value), filename, {
                  skipSelf: true,
                });
                if (resolved && !resolved.external) {
                  await discover(normalize(resolved.id));
                }
              }
            }
          }
        }
      };
      for (const entry of entries) {
        await discover(entry.filePath);
        if (rendering !== "islands") {
          emittedDocuments.set(
            documentKey(entry.collection, entry.id),
            this.emitFile({
              type: "chunk",
              id: `${entry.filePath}?cq-mdx=react`,
              name: `mdx-document-${createHash("sha256").update(documentKey(entry.collection, entry.id)).digest("hex").slice(0, 12)}`,
              preserveSignature: "strict",
            }),
          );
        }
      }
      for (const widget of widgets.values()) {
        emittedWidgets.set(
          widget.id,
          this.emitFile({
            type: "chunk",
            id: `${widgetPrefix}${widget.id}`,
            name: `mdx-widget-${widget.id}`,
            preserveSignature: "strict",
          }),
        );
      }
      if (Object.values(serverStyles).some((styles) => styles.length)) {
        styleEntry = this.emitFile({ type: "chunk", id: stylesId, name: "mdx-styles" });
      }
    },
    resolveId(source) {
      if (source.startsWith(prefix)) {
        return source;
      }
      if (source === "content-query:mdx:server") {
        return serverId;
      }
    },
    async load(id) {
      const filename = normalize(id.split("?")[0]!);
      if (filename.endsWith(".mdx")) {
        const target =
          new URLSearchParams(id.split("?")[1]).get("cq-mdx") === "islands" ? "islands" : "react";
        const cached = await analysis(filename);
        let compiled = cached.compiled.get(target);
        if (!compiled) {
          compiled = cached.value.then((parsed) =>
            compileAnalysis(parsed, {
              ...options,
              target,
              resolveMdxImport: async (specifier, inherited) => {
                const resolved = await this.resolve(specifier, filename, { skipSelf: true });
                if (!resolved || resolved.external) {
                  this.error(`Cannot resolve MDX import ${specifier} from ${filename}.`);
                }
                return `${normalize(resolved.id)}?cq-mdx=${inherited}`;
              },
              resolveIsland: async (reference) => {
                const resolved = await this.resolve(reference.source, filename, { skipSelf: true });
                if (!resolved || resolved.external) {
                  this.error(`Cannot resolve MDX widget ${reference.source} from ${filename}.`);
                }
                const module = normalize(resolved.id);
                const widgetId = createHash("sha256")
                  .update(`${normalize(path.relative(config.root, module))}:${reference.imported}`)
                  .digest("hex")
                  .slice(0, 20);
                widgets.set(widgetId, { id: widgetId, module, imported: reference.imported });
                return { id: widgetId, clientOnlyImport: `${onlyPrefix}${widgetId}` };
              },
            }),
          );
          cached.compiled.set(target, compiled);
        }
        const result = await compiled;
        return { code: result.code, map: result.map };
      }
      if (id === stylesId) {
        return (
          [...new Set(Object.values(serverStyles).flat())]
            .map((style) => `import ${JSON.stringify(style)};`)
            .join("\n") + "\nexport const styles = true;"
        );
      }
      if (id === probeId) {
        await prepare();
        return `export const documents = [${entries
          .map((entry) => `()=>import(${JSON.stringify(`${entry.filePath}?cq-mdx=islands`)})`)
          .join(",")}];`;
      }
      if (id.startsWith(widgetPrefix) || id.startsWith(onlyPrefix)) {
        const only = id.startsWith(onlyPrefix);
        const widget = widgets.get(id.slice(only ? onlyPrefix.length : widgetPrefix.length));
        if (!widget) {
          this.error(`Unknown MDX widget entry ${id}.`);
        }
        if (only) {
          return `"use client";\nimport {createClientOnly} from "@content-query/mdx/react";\nexport default createClientOnly(() => import(${JSON.stringify(widget.module)}).then(module => module${exported(widget.imported)}));`;
        }
        return `import * as module from ${JSON.stringify(widget.module)};\nimport {mountReactIsland} from "@content-query/mdx/react/client";\nexport function mount(element,props,options){return mountReactIsland(element,module${exported(widget.imported)},props,options);}`;
      }
      if (id === serverId) {
        if (this.environment.config.consumer === "client") {
          this.error(
            "MDX collection lookups and rendering are server-only. Send a selected module reference to @content-query/mdx/client.",
          );
        }
        return `export {loadMdx,loadMdxDocument} from ${JSON.stringify(reactId)};\nexport {renderMdx} from ${JSON.stringify(islandsId)};\nexport {getMdxAssets} from ${JSON.stringify(assetsId)};`;
      }
      if (id === assetsId) {
        if (this.environment.config.consumer === "client") {
          this.error(
            "The complete MDX asset manifest is server-only. Send only selected references to the browser.",
          );
        }
        if (config.command === "serve") {
          return `export async function getMdxAssets(){return globalThis[Symbol.for("content-query-mdx.dev-assets")].get(${JSON.stringify(bridgeKey)})();}`;
        }
        if (appBuild && this.environment.name !== probeEnvironment) {
          const manifest = await readFile(path.join(directory(), "manifest.json"), "utf8");
          return `import {createMdxAssets} from "@content-query/mdx/assets";\nconst assets=createMdxAssets(${manifest});\nexport async function getMdxAssets(){return assets;}`;
        }
        return `export async function getMdxAssets(){throw new Error("Pass the production MDX asset manifest to the server renderer.");}`;
      }
      if (id !== reactId && id !== islandsId) {
        return;
      }
      if (this.environment.config.consumer === "client") {
        this.error(
          "MDX collection lookups and rendering are server-only. Send a selected module reference to @content-query/mdx/client.",
        );
      }
      await prepare();
      const target = id === islandsId ? "islands" : "react";
      const table = entries
        .map(
          (entry) =>
            `[${JSON.stringify(documentKey(entry.collection, entry.id))},()=>import(${JSON.stringify(`${entry.filePath}?cq-mdx=${target}`)})]`,
        )
        .join(",\n");
      const loading = `const entries=new Map([${table}]);\nconst loaded=new Map();\nasync function load(collection,id){const key=JSON.stringify([collection,id]);if(!entries.has(key))throw new Error("Unknown MDX document "+key);let pending=loaded.get(key);if(!pending){pending=entries.get(key)().catch(cause=>{loaded.delete(key);throw cause;});loaded.set(key,pending);}return pending;}\n`;
      return id === reactId
        ? `import {getMdxAssets} from ${JSON.stringify(assetsId)};\nimport {prepareMdxDocument} from "@content-query/mdx/react/server";\n${loading}export const loadMdx=load;\nexport async function loadMdxDocument(collection,id){const module=await load(collection,id);const assets=await getMdxAssets();return prepareMdxDocument(assets.document(collection,id),module);}`
        : `import {getMdxAssets} from ${JSON.stringify(assetsId)};\nimport {renderMdxModule} from "@content-query/mdx/react/server";\n${loading}export async function renderMdx(collection,id,options={}){const module=await load(collection,id);const assets=options.assets??await getMdxAssets();return renderMdxModule(module,{...options,assets},assets.styles(collection,id));}`;
    },
    transform: {
      order: "post",
      handler(code, id) {
        if (
          /\.module\.(?:css|scss|sass|less)(?:\?|$)/.test(id) &&
          Object.values(serverStyles).some((styles) => styles.includes(id))
        ) {
          return { code, map: null, moduleSideEffects: "no-treeshake" };
        }
      },
    },
    async buildEnd(error) {
      if (error || config.command !== "build" || this.environment.config.consumer !== "server") {
        return;
      }
      const styles: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
      for (const entry of entries) {
        styles[documentKey(entry.collection, entry.id)] = collectStyles(
          [`${entry.filePath}?cq-mdx=react`, `${entry.filePath}?cq-mdx=islands`],
          (id) => this.getModuleInfo(id)?.importedIds ?? [],
        );
      }
      await writeFile(path.join(directory(), "styles.json"), JSON.stringify(styles));
    },
    async generateBundle(_output, bundle) {
      const assets = Object.values(bundle)
        .filter((item) => item.type === "asset" && !/\.(?:css|[cm]?js|map)$/.test(item.fileName))
        .map((item) => item.fileName);
      if (this.environment.config.consumer === "server") {
        await writeFile(path.join(directory(), "assets.json"), JSON.stringify(assets));
        for (const filename of assets) {
          const asset = bundle[filename]!;
          if (asset.type === "asset") {
            const destination = path.join(directory(), "static", filename);
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, asset.source);
          }
        }
        return;
      }
      if (this.environment.config.consumer !== "client") {
        return;
      }
      for (const filename of serverAssets) {
        if (!bundle[filename]) {
          this.emitFile({
            type: "asset",
            fileName: filename,
            source: await readFile(path.join(directory(), "static", filename)),
          });
        }
      }
      /** Resolves hashed styles recursively without preloading JavaScript for deferred widgets. */
      const css = (filename: string, seen = new Set<string>()): string[] => {
        if (seen.has(filename)) {
          return [];
        }
        seen.add(filename);
        const chunk = bundle[filename];
        if (chunk?.type !== "chunk") {
          return [];
        }
        const metadata = chunk as unknown as OutputChunk;
        return [
          ...(metadata.viteMetadata?.importedCss ?? []),
          ...metadata.imports.flatMap((imported) => css(imported, seen)),
        ];
      };
      /** Publishes public URLs while keeping the complete reference index on the server. */
      const reference = (ref: string): MdxClientReference => {
        const filename = this.getFileName(ref);
        return {
          url: `${config.base}${filename}`,
          css: [...new Set(css(filename))].map((style) => `${config.base}${style}`),
        };
      };
      const common = styleEntry ? reference(styleEntry).css : [];
      const manifest: MdxAssetManifest = {
        version: 1,
        documents: Object.create(null) as MdxAssetManifest["documents"],
        islands: Object.create(null) as MdxAssetManifest["islands"],
        assets: [...new Set([...serverAssets, ...assets])]
          .sort()
          .map((asset) => `${config.base}${asset}`),
      };
      for (const entry of entries) {
        const key = documentKey(entry.collection, entry.id);
        const ref = emittedDocuments.get(key);
        const client = ref ? reference(ref) : undefined;
        manifest.documents[key] = {
          css: [...new Set([...common, ...(client?.css ?? [])])],
          ...(client ? { client } : {}),
        };
      }
      for (const [id, ref] of emittedWidgets) {
        manifest.islands[id] = reference(ref);
      }
      this.emitFile({
        type: "asset",
        fileName: ".vite/content-query-mdx-manifest.json",
        source: JSON.stringify(manifest, null, 2),
      });
      await writeFile(path.join(directory(), "manifest.json"), JSON.stringify(manifest));
    },
    handleHotUpdate(context) {
      analyses.delete(normalize(context.file));
      if ([...widgets.values()].some((widget) => widget.module === normalize(context.file))) {
        context.server.ws.send({ type: "full-reload" });
      }
    },
    closeBundle() {
      unsubscribe?.();
      (globalThis as BridgeGlobal)[bridgeSymbol]?.delete(bridgeKey);
    },
  };
}
