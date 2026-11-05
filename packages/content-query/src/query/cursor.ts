import { ContentError } from "../shared/errors.ts";
import { decode, encode, isScalar } from "../shared/values.ts";
import type { SortClause } from "./plan.ts";

/** Changes whenever the encoded cursor layout changes, so older cursors fail clearly. */
const CURSOR_VERSION = 1;
/** Bounds the work spent on client-supplied cursors, which usually arrive in URLs. */
const MAX_CURSOR_LENGTH = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Encodes UTF-8 text as unpadded base64url without relying on Node's `Buffer`. */
function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes unpadded base64url into UTF-8 text, rejecting invalid byte sequences. */
function fromBase64Url(encoded: string): string {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Describes an order as `[field, direction]` pairs, the form a cursor records. */
function orderPairs(order: readonly SortClause[]): [string, "asc" | "desc"][] {
  return order.map((sort) => [sort.field, sort.direction]);
}

/** Checks a decoded cursor order against the query's order without trusting its shape. */
function sameOrder(candidate: unknown, order: readonly SortClause[]): boolean {
  return (
    Array.isArray(candidate) &&
    candidate.length === order.length &&
    order.every((sort, index) => {
      const pair: unknown = candidate[index];
      return (
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair[0] === sort.field &&
        pair[1] === sort.direction
      );
    })
  );
}

/** Rejects a client-supplied cursor that cannot position this query. */
function invalidCursor(collection: string, message: string, cause?: unknown): never {
  throw new ContentError({
    code: "invalid-cursor",
    operation: "query",
    collection,
    message,
    cause,
  });
}

/**
 * Encodes an entry's position in a query's order as an opaque cursor. The cursor records the
 * collection, the effective order, and the entry's sort values, with rich values such as dates and
 * `BigInt`s preserved.
 *
 * @param collection - The queried collection.
 * @param order - The query's effective order, including the ID tie-breaker.
 * @param key - The entry's values for each sort clause, in order.
 * @returns An opaque, URL-safe cursor string.
 */
export function encodeCursor(
  collection: string,
  order: readonly SortClause[],
  key: readonly unknown[],
): string {
  return toBase64Url(encode([CURSOR_VERSION, collection, orderPairs(order), [...key]]));
}

/**
 * Decodes a cursor into sort values for this query. A cursor stays valid when filters change, but
 * only for the same collection and effective order it was created with.
 *
 * @param cursor - A cursor from an earlier page of the same query.
 * @param collection - The queried collection.
 * @param order - The query's effective order, including the ID tie-breaker.
 * @returns The boundary entry's sort values, in order.
 * @throws ContentError with code `invalid-cursor` when the cursor is malformed or belongs to a
 * different collection or order.
 */
export function decodeCursor(
  cursor: unknown,
  collection: string,
  order: readonly SortClause[],
): unknown[] {
  if (typeof cursor !== "string" || cursor.length > MAX_CURSOR_LENGTH || !BASE64URL.test(cursor)) {
    invalidCursor(collection, "The cursor is not a cursor returned by paginate().");
  }
  let decoded: unknown;
  try {
    decoded = decode(fromBase64Url(cursor));
  } catch (cause) {
    invalidCursor(collection, "The cursor is not a cursor returned by paginate().", cause);
  }
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 4 ||
    decoded[0] !== CURSOR_VERSION ||
    !Array.isArray(decoded[3]) ||
    !(decoded[3] as unknown[]).every(isScalar)
  ) {
    invalidCursor(collection, "The cursor is not a cursor returned by paginate().");
  }
  const [, cursorCollection, cursorOrder, key] = decoded as [number, unknown, unknown, unknown[]];
  if (
    cursorCollection !== collection ||
    !sameOrder(cursorOrder, order) ||
    key.length !== order.length
  ) {
    invalidCursor(
      collection,
      "The cursor belongs to a query with a different collection or sort order.",
    );
  }
  return key;
}
