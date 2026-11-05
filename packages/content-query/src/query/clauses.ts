import { invalidQuery } from "../shared/errors.ts";
import { decodeCursor } from "./cursor.ts";
import {
  assertAvailable,
  effectiveOrder,
  PAGINATE_AFTER_LIMIT_MESSAGE,
  type PaginatePlan,
  type PlanPayload,
  type QueryPlan,
  type QueryRegistry,
} from "./plan.ts";

/** Option names that `paginate()` reads; relational options pass the rest to the query plan. */
export const PAGINATE_KEYS = ["page", "size", "after", "before", "total"] as const;

/**
 * Checks `paginate()` options against a selected root plan and compiles them into a page request.
 * Cursors are decoded here, so execution and future backends receive sort values only.
 *
 * @param plan - The root plan to paginate; it must not set its own limit or offset.
 * @param options - `{ page, size }` for page numbers, or `{ size, after?, before?, total? }` for
 * cursors. A `null` cursor starts at the first entry (`after`) or the last entry (`before`).
 * @returns The compiled page request.
 * @throws ContentError with code `invalid-query` for invalid options, or `invalid-cursor` for a
 * cursor from a different collection or order.
 */
export function checkedPaginate(plan: QueryPlan, options: unknown): PaginatePlan {
  if (plan.limit !== undefined || plan.offset !== undefined) {
    invalidQuery(PAGINATE_AFTER_LIMIT_MESSAGE);
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    invalidQuery("paginate() requires options, such as { page: 1, size: 10 } or { size: 10 }.");
  }
  const { page, size, after, before, total, ...rest } = options as Record<string, unknown>;
  const [extra] = Object.keys(rest);
  if (extra !== undefined) {
    invalidQuery(`Unknown paginate() option "${extra}".`);
  }
  if (!Number.isSafeInteger(size) || (size as number) < 1) {
    invalidQuery("paginate() requires a positive safe integer size.");
  }
  if (page !== undefined) {
    if (after !== undefined || before !== undefined || total !== undefined) {
      invalidQuery(
        "Page-number pagination cannot use after, before, or total; its results always include total.",
      );
    }
    if (!Number.isSafeInteger(page) || (page as number) < 1) {
      invalidQuery("paginate() requires a positive safe integer page, starting at 1.");
    }
    return { mode: "page", page: page as number, size: size as number };
  }
  if (after !== undefined && before !== undefined) {
    invalidQuery("paginate() accepts an after or a before cursor, not both.");
  }
  if (total !== undefined && typeof total !== "boolean") {
    invalidQuery("paginate() requires total to be a boolean.");
  }
  const direction = before !== undefined ? "before" : "after";
  const cursor = direction === "before" ? before : after;
  return {
    mode: "cursor",
    size: size as number,
    direction,
    total: total === true,
    ...(cursor === null || cursor === undefined
      ? {}
      : { key: decodeCursor(cursor, plan.collection, effectiveOrder(plan)) }),
  };
}

/** Checks scalar field selection for both public query frontends without a schema field catalog. */
export function checkedFields(
  registry: QueryRegistry,
  collection: string,
  fields: string[],
): string[] {
  const scope = registry[collection];
  for (const field of fields) {
    if (typeof field === "string") {
      assertAvailable(registry, collection, field);
    }
  }
  if (
    !scope ||
    fields.some(
      (field) =>
        typeof field !== "string" ||
        !field ||
        field === "_adjacent" ||
        field === "_payloads" ||
        Object.hasOwn(scope.relationships, field),
    ) ||
    new Set(fields).size !== fields.length
  ) {
    invalidQuery(
      "Selection requires distinct prepared fields; use relationship or adjacency selection explicitly.",
    );
  }
  return [...fields];
}

/** Checks one sort clause with the same cardinality and duplicate rules in either API. */
export function checkedOrder(
  plan: QueryPlan,
  field: string,
  direction: "asc" | "desc",
  many: boolean,
): QueryPlan["order"] {
  if (
    !many ||
    typeof field !== "string" ||
    !field ||
    !["asc", "desc"].includes(direction) ||
    plan.order.some((sort) => sort.field === field)
  ) {
    invalidQuery("Invalid or repeated sort, or sorting a singular relationship.");
  }
  return [...plan.order, { field, direction }];
}

/** Checks pagination before either frontend constructs its shared query plan. */
export function checkedPagination(value: number, many: boolean): number {
  if (!many || !Number.isSafeInteger(value) || value < 0) {
    invalidQuery("Pagination requires a nonnegative safe integer and a many-valued scope.");
  }
  return value;
}

/** Finds a payload declaration that queries may request, rejecting unknown names. */
function payloadDescriptor(registry: QueryRegistry, collection: string, name: string) {
  const payloads = registry[collection]?.payloads ?? {};
  if (typeof name !== "string" || !Object.hasOwn(payloads, name)) {
    invalidQuery(`Unknown payload "${String(name)}" for collection "${collection}".`);
  }
  return payloads[name]!;
}

/** Checks one payload request against the collection's payload names and variant keys. */
export function checkedPayload(
  registry: QueryRegistry,
  collection: string,
  name: string,
  request: unknown,
): PlanPayload {
  const { variants } = payloadDescriptor(registry, collection, name);
  if (request === true || request === undefined) {
    if (variants.length) {
      invalidQuery(`Payload "${name}" requires variant keys: ${variants.join(", ")}.`);
    }
    return { variant: {} };
  }
  const variant = request as Record<string, unknown>;
  if (
    !variant ||
    typeof variant !== "object" ||
    Array.isArray(variant) ||
    Object.keys(variant).length !== variants.length ||
    variants.some((key) => !Object.hasOwn(variant, key) || !isVariantValue(variant[key]))
  ) {
    invalidQuery(
      `Payload "${name}" requires exactly these variant keys, each a string or a nonempty array of strings: ${variants.join(", ") || "none"}.`,
    );
  }
  // Earlier keys in the request change slowest, so { locale: ["fr", "en"] } tries fr, then en.
  let combinations: Record<string, string>[] = [{}];
  for (const key of Object.keys(variant)) {
    const values = [variant[key]].flat() as string[];
    combinations = combinations.flatMap((partial) =>
      values.map((value) => ({ ...partial, [key]: value })),
    );
  }
  // Plans store keys sorted, matching prepared variant identities; repeated combinations go.
  const sorted = [...variants].sort();
  const unique = new Map(
    combinations.map((combination) => {
      const canonical = Object.fromEntries(sorted.map((key) => [key, combination[key]!]));
      return [JSON.stringify(canonical), canonical];
    }),
  );
  const [first, ...fallbacks] = unique.values();
  return fallbacks.length ? { variant: first!, fallbacks } : { variant: first! };
}

/** Checks one variant key's request: a value, or a nonempty list of values to try in order. */
function isVariantValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string"))
  );
}

/** Compiles a payloads option into plan requests, omitting payloads set to false. */
export function checkedPayloads(
  registry: QueryRegistry,
  collection: string,
  payloads: Record<string, unknown>,
): QueryPlan["payloads"] {
  const requested: Record<string, PlanPayload> = Object.create(null) as Record<string, PlanPayload>;
  for (const [name, request] of Object.entries(payloads)) {
    if (request === false || request === undefined) {
      payloadDescriptor(registry, collection, name);
      continue;
    }
    requested[name] = checkedPayload(registry, collection, name, request);
  }
  return Object.keys(requested).length ? requested : undefined;
}
