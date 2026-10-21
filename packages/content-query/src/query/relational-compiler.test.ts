import { describe, expect, test } from "vite-plus/test";
import { relationalPlan, relationalWhere, createQueryNamespace } from "./relational.ts";
import { objectPlan } from "./object.ts";
import { normalizePlan } from "./normalize.ts";
import { eq, validateExpression } from "./operators.ts";
import { matches } from "../runtime/filter.ts";
import type { Expression, QueryRegistry } from "./plan.ts";

const registry: QueryRegistry = {
  posts: {
    relationships: {
      author: {
        collection: "authors",
        type: "one",
        from: "authorId",
        to: "id",
        referenceSide: "from",
      },
    },
  },
  authors: { relationships: {} },
};

describe("relational query compilation", () => {
  test("retains the normalized plan used by equivalent existing object queries", () => {
    expect(
      normalizePlan(
        relationalPlan(registry, "posts", {
          columns: { id: true },
          where: { draft: false, rank: { gte: 2 } },
          with: { author: { columns: { name: true } } },
          orderBy: { rank: "asc" },
          limit: 2,
        }),
      ),
    ).toEqual(
      normalizePlan(
        objectPlan(registry, "posts", {
          select: { id: true, author: { select: { name: true } } },
          where: { draft: false, rank: { gte: 2 } },
          orderBy: { rank: "asc" },
          limit: 2,
        }),
      ),
    );
  });

  test.each([
    [
      { value: { eq: 2, ne: 3, gt: 1, gte: 2, lt: 3, lte: 2, in: [2], notIn: [1] } },
      { value: 2 },
      true,
    ],
    [{ value: { AND: [{ gt: 0 }, { NOT: { eq: 2 } }] } }, { value: 1 }, true],
    [{ value: { OR: [] } }, { value: 1 }, false],
    [
      { value: { arrayContains: [1, 2], arrayOverlaps: [2], arrayContained: [1, 2, 3] } },
      { value: [1, 2] },
      true,
    ],
    [{ value: { arrayContained: [] } }, { value: [1] }, false],
    [{ value: { arrayContains: [], arrayContained: [] } }, { value: [] }, true],
    [{ value: { arrayContained: [1] } }, { value: 1 }, false],
    [
      { value: { like: "A_%", ilike: "a_%", notLike: "B%", notIlike: "b%" } },
      { value: "Abc" },
      true,
    ],
    [{ value: { like: "a\\%\\_" } }, { value: "a%_" }, true],
    [{ value: { like: "a\\" } }, { value: "a\\" }, true],
    [{ value: { like: "a.b" } }, { value: "a.b" }, true],
    [{ value: { like: "a.b" } }, { value: "axb" }, false],
    [{ value: { like: "a%" } }, { value: "a\nb" }, true],
    [{ value: { like: "a" } }, { value: "a\n" }, false],
    [{ value: { like: "_" } }, { value: "😀" }, true],
    [{ value: { ilike: "%" } }, { value: 1 }, false],
    [{ value: { contains: "b", startsWith: "a", endsWith: "c" } }, { value: "abc" }, true],
    [{ value: { isNull: true, isNotNull: false } }, { value: null }, true],
    [{ value: { isNotNull: true, isUndefined: true, isMissing: true } }, {}, true],
    [{ AND: [{ value: 1 }], NOT: [{ value: 2 }, { value: 3 }] }, { value: 1 }, true],
    [{ OR: [] }, { value: 1 }, false],
    [{ value: new Date(0) }, { value: new Date(0) }, true],
  ])("evaluates portable filters %j", (where, value, expected) => {
    expect(matches(value, relationalWhere(registry, "posts", where))).toBe(expected);
  });

  test("supports explicit structured expressions for reserved field names", () => {
    const expression = relationalWhere(registry, "posts", {
      RAW: (fields: { AND: { name: string } }) => eq(fields.AND as never, true as never),
    });
    expect(matches({ AND: true }, expression)).toBe(true);
  });

  test.each([
    { where: false },
    { where: { RAW: true } },
    { where: { RAW: () => true } },
    { where: { OR: {} } },
    { where: { value: { OR: {} } } },
    { where: { value: { isNull: 1 } } },
    { where: { value: { like: 1 } } },
    { where: { value: { arrayContains: 1 } } },
    { where: { value: { eq: {} } } },
    { where: { value: { unknown: 1 } } },
    { orderBy: {} },
    { orderBy: { id: "invalid" } },
    { with: [] },
    { with: { author: null } },
    { limit: -1 },
    { offset: 0.5 },
    { adjacent: { with: { author: { adjacent: true } } } },
  ])("rejects malformed options %j", (options) => {
    expect(() => relationalPlan(registry, "posts", options)).toThrow();
  });

  test("validates relation expressions and rejects use outside a prepared scope", () => {
    const expression = relationalWhere(registry, "posts", { author: true });
    expect(() => matches({ id: "a" }, expression)).toThrow(/scope/);
    expect(() =>
      validateExpression({
        kind: "relation",
        collection: "",
        field: "author",
        target: "authors",
        expression,
      } as Expression),
    ).toThrow(/Relationship/);
    expect(() => relationalPlan(registry, "missing", {})).toThrow(/collection/);
  });
});

describe("relational query namespace", () => {
  test("retains stable handles while adding and removing prototype-like collection names", async () => {
    let current: QueryRegistry = Object.fromEntries(
      ["posts", "__proto__", "constructor", "name", "length", "prototype", "then"].map((name) => [
        name,
        { relationships: {} },
      ]),
    );
    const namespace = createQueryNamespace(
      () => current,
      async (plan) => [plan.collection],
    ) as Record<string, { findMany(): Promise<string[]> }>;
    const posts = namespace.posts!;
    expect(namespace.posts).toBe(posts);
    for (const name of Object.keys(current)) {
      expect(await namespace[name]!.findMany()).toEqual([name]);
      expect(Object.hasOwn(namespace, name)).toBe(true);
    }
    expect(Reflect.get(namespace, Symbol.iterator)).toBeUndefined();
    expect(Reflect.getOwnPropertyDescriptor(namespace, "missing")).toBeUndefined();
    current = { authors: { relationships: {} } };
    expect(namespace.posts).toBeUndefined();
    expect(() => posts.findMany()).toThrow(/collection/);
    expect(await namespace.authors!.findMany()).toEqual(["authors"]);
  });
});
