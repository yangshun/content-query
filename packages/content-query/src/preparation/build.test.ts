import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import type { CollectionDefinition } from "../collection/types.ts";
import { buildContent, type BuildContentOptions } from "../build.ts";
import { buildAtRoot } from "./build.ts";

describe("content build entry points", () => {
  for (const options of [
    { backend: "sqlite" },
    { watch: "true" },
    { config: false },
    { outDir: 1 },
  ]) {
    test(`rejects malformed options before loading configuration: ${JSON.stringify(options)}`, async () => {
      await expect(
        buildAtRoot(".", options as unknown as BuildContentOptions),
      ).rejects.toMatchObject({ code: "source-error", message: "Invalid build options." });
    });
  }

  test("builds typed in-memory content from an explicit custom configuration path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-public-build-"));
    const filename = path.join(root, "collections.ts");
    const schema = z.object({ title: z.string() });
    type Registry = {
      posts: CollectionDefinition<typeof schema, {}, {}> & { schema: typeof schema };
    };
    const library = new URL("../index.ts", import.meta.url);
    const validator = new URL("../../node_modules/zod/index.js", import.meta.url);
    try {
      await writeFile(
        filename,
        `import {defineCollection} from ${JSON.stringify(library.href)};
import {z} from ${JSON.stringify(validator.href)};
export const collections = {posts: defineCollection({loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title: "Standalone"}}); }}, schema: z.object({title: z.string()})})};`,
      );
      const session = await buildContent<Registry>({ config: filename, backend: "in-memory" });
      try {
        const selected: { title: string } | undefined = await session.content
          .query("posts")
          .select("title")
          .first();
        expect(selected).toEqual({
          title: "Standalone",
        });
      } finally {
        await session.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("configuration discovery", () => {
  for (const [extension, moduleType] of [
    ["ts", "module"],
    ["mts", "module"],
    ["cts", "commonjs"],
    ["js", "module"],
    ["js", "commonjs"],
    ["mjs", "module"],
    ["cjs", "commonjs"],
  ] as const) {
    test(`builds content-query.config.${extension} with ${moduleType} exports`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-config-format-"));
      const filename = `content-query.config.${extension}`;
      const annotation = extension.endsWith("ts") ? ": string" : "";
      const declaration =
        moduleType === "commonjs" ? "module.exports = { collections };" : "export { collections };";
      try {
        await writeFile(path.join(root, "package.json"), JSON.stringify({ type: moduleType }));
        await writeFile(
          path.join(root, filename),
          `const title${annotation} = "Discovered";
const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title}}); }}}};
${declaration}`,
        );
        const session = await buildAtRoot<{
          posts: CollectionDefinition<undefined, {}, {}>;
        }>(root, {});
        try {
          expect(await session.content.query("posts").select("title").first()).toEqual({
            title: "Discovered",
          });
          expect(await readFile(path.join(root, ".content-query/server.d.ts"), "utf8")).toContain(
            `typeof import("../${filename}").collections`,
          );
        } finally {
          await session.dispose();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("reports ambiguous configs without executing either file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-ambiguous-config-"));
    try {
      for (const filename of ["content-query.config.ts", "content-query.config.mjs"]) {
        await writeFile(path.join(root, filename), 'throw new Error("Must not execute");');
      }
      await expect(buildAtRoot(root, {})).rejects.toMatchObject({
        code: "source-error",
        message: expect.stringMatching(
          /Multiple.*content-query\.config\.ts.*content-query\.config\.mjs/,
        ),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an explicit config bypasses discovery and never falls back to another file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-explicit-config-"));
    try {
      await mkdir(path.join(root, "config"));
      for (const filename of ["content-query.config.ts", "content-query.config.js"]) {
        await writeFile(path.join(root, filename), 'throw new Error("Must not execute");');
      }
      await writeFile(path.join(root, "config/collections.mts"), "export const collections = {};");
      const session = await buildAtRoot(root, {
        config: "./config/collections.mts",
        backend: "in-memory",
      });
      await session.dispose();
      await expect(
        buildAtRoot(root, { config: "./config/missing.mts", backend: "in-memory" }),
      ).rejects.toMatchObject({ code: "source-error" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports missing configuration without discovering data or JSX files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-missing-config-"));
    try {
      for (const extension of ["json", "yaml", "yml", "jsx", "tsx"]) {
        await writeFile(path.join(root, `content-query.config.${extension}`), "{}");
      }
      await expect(buildAtRoot(root, {})).rejects.toMatchObject({
        code: "source-error",
        message: expect.stringMatching(/No ContentQuery configuration found.*config option/),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores config-named directories and resolves symlinked config imports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-symlinked-config-"));
    try {
      await mkdir(path.join(root, "content-query.config.ts"));
      await mkdir(path.join(root, "config"));
      await writeFile(path.join(root, "config/collections.mjs"), "export const collections = {};");
      await writeFile(
        path.join(root, "config/index.mjs"),
        'export { collections } from "./collections.mjs";',
      );
      await symlink("./config/index.mjs", path.join(root, "content-query.config.js"));
      const session = await buildAtRoot(root, { backend: "in-memory" });
      await session.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves filesystem errors while inspecting config candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-unreadable-config-"));
    const filename = path.join(root, "content-query.config.ts");
    try {
      await symlink("./content-query.config.ts", filename);
      await expect(buildAtRoot(root, {})).rejects.toMatchObject({
        code: "source-error",
        source: filename,
        cause: expect.objectContaining({ code: "ELOOP" }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
