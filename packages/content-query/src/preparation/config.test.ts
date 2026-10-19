import { collectLoader } from "../../tests/helpers/loader.ts";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { loadRegistry } from "./config.ts";

describe("loadRegistry", () => {
  for (const extension of ["ts", "mts", "cts", "js", "mjs", "cjs"]) {
    test(`reloads .${extension} configuration without retaining a previous module value`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-config-"));
      const filename = path.join(root, `content-query.config.${extension}`);
      const annotation = extension.endsWith("ts") ? ": string" : "";
      const declaration = ["cts", "cjs"].includes(extension)
        ? "module.exports = { collections };"
        : "export { collections };";
      try {
        await writeFile(path.join(root, "package.json"), '{"type":"module"}');
        await writeFile(
          filename,
          `const title${annotation} = "First"; const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title}}); }}}}; ${declaration}`,
        );
        const { registry: first } = await loadRegistry(filename);
        await writeFile(
          filename,
          `const title${annotation} = "Updated"; const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title}}); }}}}; ${declaration}`,
        );
        const { registry: next } = await loadRegistry(filename);
        expect(await collectLoader(first.posts!.loader)).toEqual([
          { id: "one", data: { title: "First" } },
        ]);
        expect(await collectLoader(next.posts!.loader)).toEqual([
          { id: "one", data: { title: "Updated" } },
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("reports exactly the modules a reload can observe as dependencies", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-config-graph-")),
    );
    const filename = path.join(root, "content-query.config.ts");
    try {
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await mkdir(path.join(root, "lib"));
      await writeFile(path.join(root, "lib/schema.ts"), "export const title: string = 'Title';\n");
      await writeFile(path.join(root, "lib/native.mjs"), "export const native = true;\n");
      await writeFile(path.join(root, "unrelated.ts"), "export const unused = true;\n");
      await writeFile(
        filename,
        `import { title } from "./lib/schema.ts";
import { native } from "./lib/native.mjs";
export const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title, native}}); }}}};`,
      );
      const { dependencies } = await loadRegistry(filename);
      // Native modules stay in Node's cache, so a reload could not observe their edits anyway.
      expect([...dependencies].sort()).toEqual([filename, path.join(root, "lib/schema.ts")]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const declaration of [
    "undefined",
    "[]",
    "{'': {loader: {load: () => []}}}",
    "{posts: null}",
    "{posts: {loader: false}}",
    "{posts: {loader: {load: false}}}",
  ]) {
    test(`rejects malformed configuration: ${declaration}`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-invalid-config-"));
      const filename = path.join(root, "content-query.config.ts");
      try {
        await writeFile(filename, `export const collections = ${declaration};`);
        await expect(loadRegistry(filename)).rejects.toThrow(
          /collections registry|requires a named loader/,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
