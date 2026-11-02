import { invalidQuery } from "../shared/errors.ts";
import type { PlanPayload, QueryPlan, QueryRegistry } from "./plan.ts";

/** Checks scalar field selection for both public query frontends without a schema field catalog. */
export function checkedFields(
  registry: QueryRegistry,
  collection: string,
  fields: string[],
): string[] {
  const scope = registry[collection];
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
    variants.some((key) => !Object.hasOwn(variant, key) || typeof variant[key] !== "string")
  ) {
    invalidQuery(
      `Payload "${name}" requires exactly these string variant keys: ${variants.join(", ") || "none"}.`,
    );
  }
  return {
    variant: Object.fromEntries([...variants].sort().map((key) => [key, variant[key] as string])),
  };
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
