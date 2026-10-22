import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FileSource, Loader, LoaderContext } from "content-query/loaders";
import { glob } from "tinyglobby";
import { slug } from "github-slugger";
import matter from "gray-matter";
import { parse } from "yaml";

/** Local MDX discovery; body compilation is owned by the companion integration. */
export type MdxLoaderOptions = {
  base: string | URL;
  pattern?: string | string[];
  generateId?(options: { entry: string; base: URL; data: Record<string, unknown> }): string;
};

/** Reads YAML frontmatter and the retained authored body without compiling or evaluating MDX. */
export function readMdx(source: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(source, { engines: { yaml: (value) => parse(value) as object } });
  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new TypeError("MDX frontmatter must be a record.");
  }
  return { data: parsed.data, body: parsed.content.replace(/^(?:[ \t]*\r?\n)+/, "") };
}

/** Declares a local MDX collection using ContentQuery's portable loader and watcher contract. */
export function mdx(options: MdxLoaderOptions): Loader<FileSource> {
  if (!options?.base || (typeof options.base !== "string" && !(options.base instanceof URL))) {
    throw new TypeError("mdx() requires a base directory.");
  }
  return {
    name: "@content-query/mdx",
    async load(context) {
      const root = fileURLToPath(context.config.root);
      const directory =
        options.base instanceof URL
          ? fileURLToPath(options.base)
          : path.resolve(root, options.base);
      const base = pathToFileURL(`${directory}${path.sep}`);
      /** Acquires and validates a complete replacement before modifying the current store. */
      async function refresh(active: LoaderContext<FileSource>): Promise<void> {
        const filenames = (
          await glob(options.pattern ?? "**/*.mdx", { cwd: directory, onlyFiles: true })
        ).sort();
        const entries: Parameters<LoaderContext<FileSource>["store"]["set"]>[0][] = [];
        const identities = new Set<string>();
        for (const entry of filenames) {
          const filePath = path.join(directory, entry);
          const text = await readFile(filePath, { encoding: "utf8", signal: active.signal });
          const { data, body } = readMdx(text);
          const relative = entry.split(path.sep).join("/");
          if (data.slug !== undefined && (typeof data.slug !== "string" || !data.slug)) {
            throw new TypeError(`MDX slug must be a nonempty string in ${filePath}.`);
          }
          const fallback =
            typeof data.slug === "string"
              ? data.slug
              : relative
                  .replace(/\.mdx$/i, "")
                  .split("/")
                  .map((segment) => slug(segment))
                  .join("/")
                  .replace(/\/index$/, "");
          const id = options.generateId
            ? options.generateId({ entry: relative, base, data })
            : fallback;
          if (typeof id !== "string" || !id || identities.has(id)) {
            throw new Error(
              `Invalid or duplicate MDX entry ID ${JSON.stringify(id)} in ${filePath}.`,
            );
          }
          identities.add(id);
          entries.push({
            id,
            data: await active.parseData({ id, data, filePath }),
            body,
            filePath,
            digest: active.generateDigest(text),
            source: { filePath: path.relative(root, filePath).split(path.sep).join("/") },
          });
        }
        active.store.clear();
        for (const entry of entries) {
          active.store.set(entry);
        }
      }
      await refresh(context);
      context.watcher?.add(directory);
      context.watcher?.on("all", async (_event, filename) => {
        const relative = path.relative(directory, filename);
        if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
          await refresh({ ...context, signal: undefined });
        }
      });
    },
  };
}
