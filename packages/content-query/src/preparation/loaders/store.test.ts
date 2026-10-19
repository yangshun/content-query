import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { createStores, type LoaderStoreState } from "./store.ts";

describe("Astro store facade", () => {
  test("supports detached reads, digests, enumeration, removals, and metadata", () => {
    const state: LoaderStoreState = { entries: new Map(), metadata: new Map() };
    const parsed = new WeakMap();
    const schema = z.object({ title: z.string() });
    const data = { title: "Hello" };
    parsed.set(data, schema);
    let changes = 0;
    const { store, meta } = createStores(
      () => state,
      parsed,
      () => {
        changes++;
      },
    );
    expect(store.set({ id: "one", data, digest: "same" })).toBe(true);
    data.title = "Mutated";
    const entry = store.get("one")!;
    expect(entry.data.title).toBe("Hello");
    expect(parsed.get(entry.data)).toBe(schema);
    entry.data.title = "Another mutation";
    expect(store.get("one")!.data.title).toBe("Hello");
    expect(store.set({ id: "one", data: { title: "Ignored" }, digest: "same" })).toBe(false);
    expect(store.entries()).toEqual([
      ["one", { id: "one", data: { title: "Hello" }, digest: "same" }],
    ]);
    expect(store.values()).toEqual([store.get("one")!]);
    expect(store.has("one")).toBe(true);
    expect(store.get("missing")).toBeUndefined();
    meta.set("cursor", "next");
    expect(meta.has("cursor")).toBe(true);
    expect(meta.get("cursor")).toBe("next");
    meta.delete("cursor");
    expect(meta.has("cursor")).toBe(false);
    store.delete("missing");
    store.delete("one");
    store.clear();
    store.set({ id: "two", data: {} });
    store.clear();
    expect(store.keys()).toEqual([]);
    expect(changes).toBe(4);
  });

  test("rejects invalid entries and unsupported Astro rendering instead of dropping imports", () => {
    const state: LoaderStoreState = { entries: new Map(), metadata: new Map() };
    const { store } = createStores(
      () => state,
      new WeakMap(),
      () => {},
    );
    expect(() => store.set({ id: "", data: {} })).toThrow(/nonempty id/);
    for (const extra of [
      { deferredRender: true },
      { assetImports: ["./image.png"] },
      { imageImports: [["cover"]] },
      { rendered: { html: "", metadata: { imagePaths: ["./image.png"] } } },
    ]) {
      expect(() => store.set({ id: "one", data: {}, ...extra })).toThrow(/rendering pipeline/);
    }
    expect(() => store.addModuleImport("./entry.mdx")).toThrow(/rendering pipeline/);
    expect(state.entries.size).toBe(0);
  });
});
