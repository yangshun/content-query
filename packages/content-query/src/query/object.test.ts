import { describe, expect, test } from "vite-plus/test";
import { objectPlan, objectWhere } from "./object.ts";
import { createBuilder } from "./builder.ts";
import { emptyPlan, type QueryPlan, type QueryRegistry } from "./plan.ts";
import { normalizePlan } from "./normalize.ts";
import { eq, gte } from "./operators.ts";
import { matches } from "../runtime/filter.ts";

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

describe("object query compilation", () => {
  test("normalizes both frontends to the same backend plan", async () => {
    let captured: QueryPlan | undefined;
    const builder = createBuilder(
      registry,
      async (plan) => {
        captured = normalizePlan(plan);
        return [];
      },
      emptyPlan("posts"),
    ) as import("./types.ts").Query<
      {
        posts: {
          loader: never;
          schema: import("zod").ZodObject<{
            draft: import("zod").ZodBoolean;
            rank: import("zod").ZodNumber;
          }>;
        };
      },
      "posts"
    >;
    await builder
      .where((fields) => eq(fields.draft, false))
      .where((fields) => gte(fields.rank, 2))
      .select("id")
      .orderBy("rank")
      .limit(2)
      .selectAdjacent()
      .all();
    const object = normalizePlan(
      objectPlan(registry, "posts", {
        where: { draft: false, rank: { gte: 2 } },
        select: { id: true, _adjacent: true },
        orderBy: { rank: "asc" },
        limit: 2,
      }),
    );
    expect(object).toEqual(captured);
    expect(object.filters).toEqual([
      { kind: "predicate", operator: "eq", field: "draft", value: false },
      { kind: "predicate", operator: "gte", field: "rank", value: 2 },
    ]);
  });

  test.each([
    [
      { value: { equals: 2, not: 3, gt: 1, gte: 2, lt: 3, lte: 2, in: [2], notIn: [1] } },
      { value: 2 },
      true,
    ],
    [{ value: { not: { equals: 2 } } }, { value: 1 }, true],
    [{ value: { has: 1, hasSome: [2], hasEvery: [1, 2] } }, { value: [1, 2] }, true],
    [{ value: { isMissing: true } }, {}, true],
    [{ value: { isUndefined: true } }, { value: undefined }, true],
    [{ value: { isNull: false } }, { value: undefined }, true],
    [{ AND: [{ value: 1 }, { NOT: [{ value: 2 }, { value: 3 }] }] }, { value: 1 }, true],
    [{ OR: [] }, {}, false],
    [{ value: new Date(0) }, { value: new Date(0) }, true],
  ])("uses the shared predicate semantics for %j", (where, value, expected) => {
    expect(matches(value, objectWhere(where))).toBe(expected);
  });

  test("supports callback predicates, relation-only projection, and explicit false fields", () => {
    expect(
      objectPlan(registry, "posts", {
        where: (fields: { id: { name: string } }) => eq(fields.id as never, "a" as never),
        select: { id: false, author: { select: { name: true } } },
      }),
    ).toMatchObject({ select: [], with: { author: { select: ["name"] } } });
  });

  test.each([
    null,
    [],
    { select: {} },
    { select: { id: false } },
    { select: { id: 1 } },
    { extra: true },
    { orderBy: {} },
    { orderBy: { id: "wrong" } },
    { orderBy: [{ id: "asc" }, { id: "desc" }] },
    { limit: -1 },
    { offset: 0.5 },
    { select: { author: true } },
    { select: { author: {} } },
    { select: { author: { select: { id: true }, limit: 1 } } },
    { select: { _adjacent: {} } },
    { select: { _adjacent: { select: { id: true }, limit: 1 } } },
    { select: { _adjacent: { select: { id: true, _adjacent: true } } } },
    { select: { _adjacent: { select: { author: { select: { _adjacent: true } } } } } },
    { where: { title: { typo: "x" } } },
    { where: { title: { isNull: 1 } } },
    { where: { title: { contains: 2 } } },
    { where: false },
    { where: () => true },
  ])("rejects malformed options %j", (options) => {
    expect(() => objectPlan(registry, "posts", options)).toThrow();
  });

  test("rejects unknown collections and invalid fluent adjacency scopes", () => {
    expect(() => objectPlan(registry, "missing", {})).toThrow();
    const builder = createBuilder(registry, async () => [], emptyPlan("posts")) as {
      selectAdjacent(options?: unknown): typeof builder;
      select(...fields: string[]): typeof builder;
      limit(value: number): typeof builder;
      with(name: string, configure: (nested: typeof builder) => unknown): typeof builder;
    };
    expect(() => builder.selectAdjacent().selectAdjacent()).toThrow();
    expect(() => builder.selectAdjacent({})).toThrow();
    expect(() => builder.selectAdjacent(() => builder.select("id"))).toThrow();
    expect(() =>
      builder.selectAdjacent((siblings: typeof builder) => siblings.selectAdjacent()),
    ).toThrow();
    expect(() => builder.selectAdjacent((siblings: typeof builder) => siblings.limit(1))).toThrow();
    expect(() => builder.select("_adjacent")).toThrow();
    expect(() =>
      builder.selectAdjacent((siblings: typeof builder) =>
        siblings.with("author", (author) => author.selectAdjacent()),
      ),
    ).toThrow();
  });
});
