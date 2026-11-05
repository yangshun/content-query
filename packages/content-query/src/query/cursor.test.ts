import { describe, expect, test } from "vite-plus/test";
import { encode } from "../shared/values.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import type { SortClause } from "./plan.ts";

const order: SortClause[] = [
  { field: "publishedAt", direction: "desc" },
  { field: "id", direction: "asc" },
];

/** Encodes an arbitrary cursor body the way encodeCursor does, to model tampered cursors. */
function forged(body: unknown): string {
  return btoa(encode(body)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reads the ContentError code that decoding a cursor throws. */
function decodeError(cursor: unknown, collection = "posts", expected = order): unknown {
  try {
    decodeCursor(cursor, collection, expected);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("encodeCursor", () => {
  test("produces URL-safe cursors that round-trip rich and nullish sort values", () => {
    for (const key of [
      [new Date(Date.UTC(2026, 10, 5)), "a/b+c"],
      [null, "ümlaut"],
      [undefined, "é"],
      [Number.NaN, "x"],
      [12n ** 30n, "big"],
    ]) {
      const cursor = encodeCursor("posts", order, key);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(cursor, "posts", order)).toEqual(key);
    }
  });
});

describe("decodeCursor", () => {
  test("rejects cursors for another collection or order", () => {
    const cursor = encodeCursor("posts", order, [null, "a"]);
    expect(decodeError(cursor, "authors")).toMatchObject({
      code: "invalid-cursor",
      collection: "authors",
      message: expect.stringMatching(/different collection or sort order/),
    });
    for (const expected of [
      [{ field: "id", direction: "asc" }],
      [
        { field: "publishedAt", direction: "asc" },
        { field: "id", direction: "asc" },
      ],
    ] satisfies SortClause[][]) {
      expect(decodeError(cursor, "posts", expected)).toMatchObject({ code: "invalid-cursor" });
    }
  });

  test("rejects malformed, oversized, and tampered cursors", () => {
    const cases: unknown[] = [
      42,
      "",
      "has spaces",
      "A".repeat(4097),
      "AAAA",
      btoa("ÿþ"),
      forged([2, "posts", [], []]),
      forged({ version: 1 }),
      forged([1, "posts", order.map((sort) => [sort.field, sort.direction]), [{}, "a"]]),
      forged([1, "posts", [["publishedAt", "desc"], 7n], [null, "a"]]),
      forged([1, "posts", order.map((sort) => [sort.field, sort.direction]), [null]]),
    ];
    for (const cursor of cases) {
      expect(decodeError(cursor)).toMatchObject({
        code: "invalid-cursor",
        operation: "query",
        collection: "posts",
      });
    }
  });
});
