import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import * as query from "../query.ts";
import { createBuilder } from "./builder.ts";
import { emptyPlan, type Expression, type QueryRegistry } from "./plan.ts";
import { matches } from "../runtime/filter.ts";
import { createSession } from "../preparation/session.ts";
import { defineCollection } from "../collection/define.ts";
import { compareStrings } from "../shared/values.ts";

const number = { name: "value" } as query.Field<number>;
const text = { name: "value" } as query.Field<string>;
const values = { name: "value" } as query.Field<(number | undefined)[] | null | undefined>;

describe("structured predicate semantics", () => {
  test.each([
    [query.eq(number, NaN), NaN, true],
    [query.eq(number, -0), 0, true],
    [query.ne(number, 1), "1", true],
    [query.gt(number, 1), 2, true],
    [query.gte(number, 2), 2, true],
    [query.lt(number, 2), 1, true],
    [query.lte(number, 2), 2, true],
    [query.gt(number, 1), NaN, false],
    [query.gt(number, NaN), 2, false],
    [query.lt(number, Infinity), -Infinity, true],
    [query.gt(number, 0), null, false],
    [query.gt(number, 0), "1", false],
    [query.contains(text, "%_"), "a%_b", true],
    [query.contains(text, "A"), "a", false],
    [query.startsWith(text, "a"), "alpha", true],
    [query.endsWith(text, "a"), "alpha", true],
    [query.endsWith(text, "a"), undefined, false],
    [query.inArray(number, [1, 2]), 2, true],
    [query.notInArray(number, [1, 2]), 2, false],
    [query.arrayContains(values, undefined), [undefined], true],
    [query.arrayContains(values, undefined), Object.assign([], { length: 1 }), false],
    [query.arrayContainsAny(values, [2]), [1, 2], true],
    [query.arrayContainsAny(values, []), [], false],
    [query.arrayContainsAll(values, [1, 1]), [1], true],
    [query.arrayContainsAll(values, []), null, false],
    [query.arrayContainsAll(values, []), undefined, false],
    [query.arrayContainsAll(values, []), [], true],
    [query.and(), undefined, true],
    [query.or(), undefined, false],
    [query.not(query.isNull(text)), undefined, true],
  ] as const)("evaluates %j against %j", (expression, value, expected) => {
    expect(matches({ value }, expression)).toBe(expected);
  });
  test("compares dates by timestamp and bigint without precision loss", () => {
    const date = { name: "value" } as query.Field<Date>;
    const bigint = { name: "value" } as query.Field<bigint>;
    expect(matches({ value: new Date(NaN) }, query.eq(date, new Date(NaN)))).toBe(true);
    expect(matches({ value: new Date(NaN) }, query.lt(date, new Date()))).toBe(false);
    expect(matches({ value: 2n ** 80n }, query.gt(bigint, 2n ** 80n - 1n))).toBe(true);
    expect(
      matches(
        { value: [new Date(0)] },
        query.arrayContains({ name: "value" } as query.Field<Date[]>, new Date(0)),
      ),
    ).toBe(true);
  });
  test("uses Unicode code points rather than JavaScript's UTF-16 order", () => {
    expect(compareStrings("\uE000", "😀")).toBe(-1);
    expect(compareStrings("a", "ab")).toBe(-1);
    expect(matches({ value: "😀" }, query.gt(text, "\uE000"))).toBe(true);
  });
  test("rejects invalid expression arguments and structures", () => {
    expect(() => query.inArray(number, "wrong" as never)).toThrow();
    expect(() => query.contains(text, 2 as never)).toThrow();
    expect(() => query.eq(number, {} as never)).toThrow();
    expect(() => query.gt(number, null as never)).toThrow();
    expect(() => query.eq(null as never, 1)).toThrow();
    expect(() => query.and(false as unknown as Expression)).toThrow();
    expect(() =>
      query.not({
        kind: "predicate",
        field: "value",
        operator: "unknown",
      } as unknown as Expression),
    ).toThrow();
  });
});

describe("builder structure and scalar sorting", () => {
  test("checks synchronous clauses and scoped callback ownership", () => {
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
    const run = async () => [];
    const builder = createBuilder(registry, run, emptyPlan("posts")) as {
      select(...fields: string[]): typeof builder;
      where(callback: unknown): typeof builder;
      with(name: string, callback: (scope: typeof builder) => unknown): typeof builder;
      limit(value: number): typeof builder;
      offset(value: number): typeof builder;
      orderBy(field: string, direction?: string): typeof builder;
      all(): Promise<unknown>;
    };
    expect(() => builder.select()).toThrow();
    expect(() => builder.select("id", "id")).toThrow();
    expect(() => builder.select("author")).toThrow();
    expect(() => builder.where(false)).toThrow();
    expect(() => builder.where(() => true)).toThrow();
    expect(() => builder.limit(1).limit(1)).toThrow();
    expect(() => builder.offset(0).offset(0)).toThrow();
    expect(() => builder.limit(0.5)).toThrow();
    expect(() => builder.offset(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => builder.orderBy("id", "random")).toThrow();
    expect(() => builder.with("missing", (scope) => scope)).toThrow();
    expect(() => builder.with("author", (scope) => scope.select("id").limit(1))).toThrow();
    expect(() => builder.with("author", (scope) => scope.select("id").all())).toThrow();
    expect(() =>
      builder.with("author", () => createBuilder(registry, run, emptyPlan("authors"))),
    ).toThrow();
    const related = builder.with("author", (scope) => scope.select("id"));
    expect(() => related.with("author", (scope) => scope.select("id"))).toThrow();
  });
  test("keeps nullish/unordered values last in either direction and preserves explicit ID order", async () => {
    const registry = {
      values: defineCollection({
        loader: fixtureLoader(() => [
          { id: "a", data: { value: undefined, bool: true } },
          { id: "b", data: { value: null, bool: false } },
          { id: "c", data: { value: NaN, bool: false } },
          { id: "d", data: { value: Infinity, bool: true } },
          { id: "e", data: { value: -Infinity, bool: true } },
        ]),
        schema: z.object({ value: z.custom<number | null | undefined>(), bool: z.boolean() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root: ".",
      config: "unused",
      outDir: "unused",
      watch: false,
      registry,
    });
    expect(
      (await session.content.select("id").from("values").orderBy("value").all()).map(
        (entry) => entry.id,
      ),
    ).toEqual(["e", "d", "c", "a", "b"]);
    expect(
      (await session.content.select("id").from("values").orderBy("value", "desc").all()).map(
        (entry) => entry.id,
      ),
    ).toEqual(["d", "e", "c", "a", "b"]);
    expect(
      (
        await session.content
          .select("id")
          .from("values")
          .orderBy("bool")
          .orderBy("id", "desc")
          .all()
      ).map((entry) => entry.id),
    ).toEqual(["c", "b", "e", "d", "a"]);
    await session.dispose();
  });
  test("rejects rich or mixed-category sorts when TypeScript is bypassed", async () => {
    const registry = {
      values: defineCollection({
        loader: fixtureLoader(() => [
          { id: "a", data: { mixed: 1, rich: new Map() } },
          { id: "b", data: { mixed: "2", rich: new Map() } },
        ]),
        schema: z.object({
          mixed: z.union([z.string(), z.number()]),
          rich: z.map(z.string(), z.string()),
        }),
      }),
    };
    const session = await createSession<typeof registry>({
      root: ".",
      config: "unused",
      outDir: "unused",
      watch: false,
      registry,
    });
    await expect(
      session.content
        .select("id")
        .from("values")
        .orderBy("mixed" as never)
        .all(),
    ).rejects.toMatchObject({ code: "invalid-query" });
    await expect(
      session.content
        .select("id")
        .from("values")
        .orderBy("rich" as never)
        .all(),
    ).rejects.toMatchObject({ code: "invalid-query" });
    // Counting ignores sorting and relationship loading, as specified.
    expect(
      await session.content
        .select()
        .from("values")
        .orderBy("rich" as never)
        .count(),
    ).toBe(2);
    await session.dispose();
  });
});
