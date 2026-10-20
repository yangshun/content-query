import { describe, expect, test } from "vite-plus/test";
import { emptyPlan, type Expression, type QueryPlan } from "../query/plan.ts";
import { executeQuery } from "./execute.ts";
import type { PreparedRevision, QueryRecord } from "./revision.ts";

/** Creates an immutable-record query fixture without involving preparation or rendering. */
function revision(records: readonly QueryRecord[]): PreparedRevision {
  return {
    registry: { entries: { relationships: {} } },
    collections: { entries: { records, relationships: {}, payloads: new Map() } },
    relations: new Map(),
    active: 0,
    payloadCache: new Map(),
    renderCache: new Map(),
  };
}

/** Models the explicitly selected ID query used by dedicated article loaders. */
function byId(id: string): QueryPlan {
  return {
    ...emptyPlan("entries"),
    select: ["id", "title"],
    filters: [{ kind: "predicate", field: "id", operator: "eq", value: id }],
  };
}

describe("ID query execution", () => {
  test("avoids rescanning unrelated IDs after the first lookup and scopes caches to records", async () => {
    let idReads = 0;
    const records = Array.from({ length: 1_000 }, (_, index) => ({
      title: `Article ${index}`,
      get id() {
        idReads++;
        return `entry-${index}`;
      },
    }));
    const prepared = revision(records);
    await executeQuery(prepared, byId("entry-0"), "first");
    idReads = 0;
    for (let index = 1; index <= 50; index++) {
      expect(await executeQuery(prepared, byId(`entry-${index}`), "first")).toEqual({
        id: `entry-${index}`,
        title: `Article ${index}`,
      });
    }
    expect(idReads).toBeLessThan(records.length);
    const next = revision([{ id: "entry-1", title: "Updated article" }]);
    expect(await executeQuery(next, byId("entry-1"), "first")).toEqual({
      id: "entry-1",
      title: "Updated article",
    });
    expect(await executeQuery(next, byId("entry-50"), "first")).toBeUndefined();
    expect(await executeQuery(prepared, byId("entry-1"), "first")).toEqual({
      id: "entry-1",
      title: "Article 1",
    });
  });

  test("retains additional filters, pagination, count semantics, and detached projections", async () => {
    const prepared = revision([{ id: "entry", title: "Article", published: true }]);
    const query = byId("entry");
    const hidden: Expression = {
      kind: "predicate",
      field: "published",
      operator: "eq",
      value: false,
    };
    expect(
      await executeQuery(prepared, { ...query, filters: [...query.filters, hidden] }, "all"),
    ).toEqual([]);
    expect(await executeQuery(prepared, { ...query, offset: 1 }, "first")).toBeUndefined();
    expect(await executeQuery(prepared, { ...query, limit: 0 }, "all")).toEqual([]);
    expect(await executeQuery(prepared, { ...query, offset: 10, limit: 0 }, "count")).toBe(1);
    const first = (await executeQuery(prepared, query, "first")) as Record<string, unknown>;
    first.title = "Changed";
    expect(await executeQuery(prepared, query, "all")).toEqual([{ id: "entry", title: "Article" }]);
    expect(await executeQuery(prepared, byId("missing"), "count")).toBe(0);
  });

  test("does not narrow OR or negated predicates to one ID", async () => {
    const prepared = revision([
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ]);
    const first = byId("one");
    const second = byId("two");
    expect(
      await executeQuery(
        prepared,
        {
          ...first,
          filters: [{ kind: "or", expressions: [first.filters[0]!, second.filters[0]!] }],
        },
        "all",
      ),
    ).toEqual([
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ]);
    expect(
      await executeQuery(
        prepared,
        { ...first, filters: [{ kind: "not", expressions: first.filters }] },
        "all",
      ),
    ).toEqual([{ id: "two", title: "Two" }]);
    expect(
      await executeQuery(
        prepared,
        { ...first, filters: [...first.filters, ...second.filters] },
        "count",
      ),
    ).toBe(0);
  });

  test("detaches projected graphs, keeping shared references within each result", async () => {
    const author = { name: "Ada" };
    const records = [
      { id: "plain", title: "Plain", author, editors: [author], date: new Date(1) },
      { id: "rich", title: "Rich", author, editors: new Set([author]), date: new Date(2) },
    ];
    const prepared = revision(records);
    const plan: QueryPlan = { ...emptyPlan("entries"), select: ["author", "editors", "date"] };
    const [plain, rich] = (await executeQuery(prepared, plan, "all")) as {
      author: typeof author;
      editors: (typeof author)[] | Set<typeof author>;
      date: Date;
    }[];
    expect((plain!.editors as (typeof author)[])[0]).toBe(plain!.author);
    expect([...(rich!.editors as Set<typeof author>)][0]).toBe(rich!.author);
    expect(plain!.author).not.toBe(author);
    expect(rich!.author).not.toBe(plain!.author);
    plain!.author.name = "Changed";
    rich!.author.name = "Changed";
    plain!.date.setTime(0);
    (plain!.editors as (typeof author)[]).length = 0;
    expect(await executeQuery(prepared, plan, "all")).toEqual([
      { author: { name: "Ada" }, editors: [{ name: "Ada" }], date: new Date(1) },
      { author: { name: "Ada" }, editors: new Set([{ name: "Ada" }]), date: new Date(2) },
    ]);
    expect(records[0]!.author).toBe(author);
    expect(author.name).toBe("Ada");
  });

  test("handles prototype-like IDs and leaves collection ordering intact", async () => {
    const records = [
      { id: "constructor", title: "Constructor" },
      { id: "__proto__", title: "Prototype" },
    ];
    const prepared = revision(records);
    expect(await executeQuery(prepared, byId("__proto__"), "first")).toEqual(records[1]);
    expect(await executeQuery(prepared, byId("constructor"), "first")).toEqual(records[0]);
    expect(records.map((entry) => entry.id)).toEqual(["constructor", "__proto__"]);
  });
});
