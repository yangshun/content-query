import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type { CollectionDefinition } from "../collection/types.ts";
import { dependencyIndex, dependencyPaths, dependents, invalidateNodes } from "./dependencies.ts";
import type { Dependency } from "./files.ts";
import type { PayloadNode, PreparationCache, PreparedEntry } from "./prepare.ts";

const base = path.resolve("/project/content/coding/two-sum");
const file = (name: string) => path.join(base, name);
const entryKey = JSON.stringify(["coding", "two-sum"]);
const otherKey = JSON.stringify(["coding", "reverse-list"]);

/** A payload node that read the given dependencies. */
function node(...dependencies: Dependency[]): PayloadNode {
  return { value: null, encoded: "null", dependencies };
}

/** Builds a cache where computed fields and payload variants read files beside the entry. */
function cache(): PreparationCache {
  const entry = (
    dependencies: Dependency[],
    payloads?: PreparedEntry["payloads"],
  ): PreparedEntry => ({
    definition: {} as CollectionDefinition,
    record: { id: "two-sum" },
    payload: {},
    dependencies,
    payloads,
  });
  return new Map([
    [
      entryKey,
      entry(
        [{ kind: "glob", base, options: { pattern: "hints/*.md" } }],
        new Map([
          [
            "detail",
            {
              combinations: [{ locale: "en-US" }, { locale: "fr-FR" }],
              nodes: new Map([
                ['{"locale":"en-US"}', node({ kind: "file", path: file("hints/en-US.md") })],
                ['{"locale":"fr-FR"}', node({ kind: "file", path: file("hints/fr-FR.md") })],
              ]),
            },
          ],
          [
            "solutions",
            {
              combinations: [{}],
              nodes: new Map([
                ["{}", node({ kind: "glob", base, options: { pattern: "solution/*.md" } })],
              ]),
            },
          ],
        ]),
      ),
    ],
    [otherKey, entry([{ kind: "file", path: path.resolve("/project/content/shared/notes.md") }])],
  ]);
}

describe("dependents", () => {
  test("finds the nodes that read a changed file", () => {
    const index = dependencyIndex(cache());
    // File reads come first, then globs whose matched files changed.
    expect(dependents(index, "change", file("hints/en-US.md"))).toEqual([
      { key: entryKey, payload: "detail", variant: '{"locale":"en-US"}' },
      { key: entryKey },
    ]);
    expect(dependents(index, "change", path.resolve("/project/content/shared/notes.md"))).toEqual([
      { key: otherKey },
    ]);
    expect(dependents(index, "change", file("walkthrough.md"))).toEqual([]);
  });

  test("finds globs that gain or lose a match, or gain a directory", () => {
    const index = dependencyIndex(cache());
    expect(dependents(index, "add", file("solution/typescript.md"))).toEqual([
      { key: entryKey, payload: "solutions", variant: "{}" },
    ]);
    expect(dependents(index, "unlink", file("hints/de-DE.md"))).toEqual([{ key: entryKey }]);
    expect(dependents(index, "addDir", file("solution"))).toEqual([
      { key: entryKey },
      { key: entryKey, payload: "solutions", variant: "{}" },
    ]);
    expect(dependents(index, "addDir", base)).toEqual([]);
  });

  test("finds every node that read inside a removed directory", () => {
    const index = dependencyIndex(cache());
    expect(dependents(index, "unlinkDir", file("hints"))).toEqual(
      expect.arrayContaining([
        { key: entryKey },
        { key: entryKey, payload: "detail", variant: '{"locale":"en-US"}' },
        { key: entryKey, payload: "detail", variant: '{"locale":"fr-FR"}' },
      ]),
    );
  });
});

describe("invalidateNodes", () => {
  test("drops one payload variant, or a whole entry for an entry node", () => {
    const prepared = cache();
    invalidateNodes(prepared, [
      { key: entryKey, payload: "detail", variant: '{"locale":"en-US"}' },
    ]);
    const detail = prepared.get(entryKey)!.payloads!.get("detail")!;
    expect([...detail.nodes.keys()]).toEqual(['{"locale":"fr-FR"}']);
    invalidateNodes(prepared, [{ key: otherKey }, { key: "missing", payload: "x", variant: "{}" }]);
    expect(prepared.has(otherKey)).toBe(false);
    expect(prepared.has(entryKey)).toBe(true);
  });
});

describe("dependencyPaths", () => {
  test("lists each read file and glob base once", () => {
    expect(dependencyPaths(dependencyIndex(cache())).sort()).toEqual(
      [
        base,
        file("hints/en-US.md"),
        file("hints/fr-FR.md"),
        path.resolve("/project/content/shared/notes.md"),
      ].sort(),
    );
  });
});
