import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { schema } from "../schema.ts";
import type { CollectionDefinition } from "../collection/types.ts";
import { buildContent, type BuildContentOptions } from "../build.ts";
import { buildAtRoot } from "./build.ts";
import { sessionInternals, type ContentSession } from "./session.ts";
import { projectFixture } from "../../tests/helpers/project.ts";

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
    const metadata = schema.object({ title: schema.string() });
    type Registry = {
      posts: CollectionDefinition<typeof metadata, {}, {}> & { schema: typeof metadata };
    };
    const library = new URL("../index.ts", import.meta.url);
    const validator = new URL("../schema.ts", import.meta.url);
    try {
      await writeFile(
        filename,
        `import {defineCollection} from ${JSON.stringify(library.href)};
import {schema} from ${JSON.stringify(validator.href)};
export const collections = {posts: defineCollection({loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title: "Standalone"}}); }}, schema: schema.object({title: schema.string()})})};`,
      );
      const session = await buildContent<Registry>({ config: filename, backend: "in-memory" });
      try {
        const selected: { title: string } | undefined = await session.content
          .select("title")
          .from("posts")
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

describe("generated watch startup cleanup", () => {
  test.each(["none", "invalid-content", "failed-publication"] as const)(
    "prunes previous runs after the first valid publication and retains this session's revisions, initial failure=%s",
    async (initialFailure) => {
      const fixture = await projectFixture(true);
      const outDir = path.join(fixture.root, ".content-query");
      const entries = path.join(outDir, "collections/posts/entries");
      const stale = path.join(entries, `${"0".repeat(64)}.js`);
      const unrelated = path.join(entries, "notes.js");
      const original = await readFile(fixture.postPath, "utf8");
      let session: ContentSession | undefined;
      try {
        await mkdir(entries, { recursive: true });
        await writeFile(stale, "Previous run");
        await writeFile(unrelated, "Application-owned file");
        if (initialFailure === "invalid-content") {
          await writeFile(
            fixture.postPath,
            original.replace("title: Getting started", "title: false"),
          );
        } else if (initialFailure === "failed-publication") {
          await mkdir(path.join(outDir, "server.js"));
        }
        session = await buildAtRoot(fixture.root, { watch: true });
        if (initialFailure !== "none") {
          expect(sessionInternals(session).state.error).toBeDefined();
          expect(await readFile(stale, "utf8")).toBe("Previous run");
          if (initialFailure === "failed-publication") {
            await rm(path.join(outDir, "server.js"), { recursive: true });
            sessionInternals(session).invalidate();
          } else {
            await writeFile(fixture.postPath, original);
          }
          await vi.waitFor(() => {
            expect(sessionInternals(session!).state.error).toBeUndefined();
            expect(sessionInternals(session!).state.revision).toBeDefined();
          });
        }
        await expect(readFile(stale, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        const initialPayload = (await readdir(entries)).find((filename) =>
          /^[a-f0-9]{64}\.js$/.test(filename),
        )!;
        const initialBytes = await readFile(path.join(entries, initialPayload), "utf8");
        await writeFile(
          fixture.postPath,
          `${original.replace("title: Getting started", "title: Updated")}\nChanged body.\n`,
        );
        await vi.waitFor(() => {
          expect(
            sessionInternals(session!).state.revision?.collections.posts?.records[0]?.title,
          ).toBe("Updated");
        });
        expect(await readFile(path.join(entries, initialPayload), "utf8")).toBe(initialBytes);
        await session.dispose();
        session = await buildAtRoot(fixture.root, { watch: true });
        await expect(readFile(path.join(entries, initialPayload), "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await readFile(unrelated, "utf8")).toBe("Application-owned file");
        expect(sessionInternals(session).state.revision?.collections.posts?.records[0]?.title).toBe(
          "Updated",
        );
      } finally {
        await session?.dispose();
        await fixture.dispose();
      }
    },
  );
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
          expect(await session.content.select("title").from("posts").first()).toEqual({
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
