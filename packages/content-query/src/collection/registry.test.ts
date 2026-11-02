import { describe, expect, test } from "vite-plus/test";
import { defineCollection } from "./define.ts";
import { hasBuiltinPayloads, queryRegistry } from "./registry.ts";
import { file, glob } from "../loaders.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";

describe("hasBuiltinPayloads", () => {
  test("follows each declaration, independent of current entries", () => {
    expect(hasBuiltinPayloads(defineCollection({ source: "./posts" }))).toBe(true);
    expect(
      hasBuiltinPayloads(defineCollection({ source: { type: "markdown", directory: "./posts" } })),
    ).toBe(true);
    for (const type of ["json", "yaml", "toml"] as const) {
      expect(hasBuiltinPayloads(defineCollection({ source: { type, directory: "./data" } }))).toBe(
        false,
      );
    }
    expect(hasBuiltinPayloads(defineCollection({ loader: glob({ pattern: "**/*.md" }) }))).toBe(
      true,
    );
    expect(hasBuiltinPayloads(defineCollection({ loader: file("./data.json") }))).toBe(false);
    expect(hasBuiltinPayloads(defineCollection({ loader: fixtureLoader(() => []) }))).toBe(true);
  });
});

describe("queryRegistry", () => {
  test("describes relationships and payloads without resolvers or schemas", () => {
    const relationships = {
      author: {
        collection: "authors",
        type: "one",
        from: "authorId",
        to: "id",
        referenceSide: "from",
      },
    } as const;
    expect(
      queryRegistry({
        posts: defineCollection({ source: "./posts", relationships }),
        authors: defineCollection({ loader: file("./authors.json") }),
      }),
    ).toEqual({
      posts: {
        relationships,
        payloads: { _body: { variants: [] }, _rendered: { variants: [] } },
      },
      authors: { relationships: {}, payloads: {} },
    });
  });
});
