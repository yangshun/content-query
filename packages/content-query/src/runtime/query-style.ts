/** Query APIs an application can allow through `queryStyle` in content-query.config. */
export type QueryStyle = "fluent" | "relational";

/**
 * Collection members that start each query style. Every other query API hangs off these members,
 * so gating them gates payloads, relationships, and adjacency as well. `count()` without options
 * belongs to both styles; `count(options)` takes relational options.
 */
export const queryStyleMembers = {
  fluent: [
    "byId",
    "select",
    "where",
    "orderBy",
    "limit",
    "offset",
    "with",
    "withPayload",
    "selectAdjacent",
  ],
  relational: ["findMany", "findFirst", "paginate", "count(options)"],
} as const satisfies Record<QueryStyle, readonly string[]>;

/** A collection member that belongs to exactly one query style. */
export type QueryStyleMember = (typeof queryStyleMembers)[QueryStyle][number];

/** Collection members that start a query in the given style. */
export type MembersOf<Style extends QueryStyle> = (typeof queryStyleMembers)[Style][number];

/**
 * Describes a disabled collection member in the type error itself, for example:
 * `posts.select is unavailable because content-query.config sets queryStyle to "relational".`
 */
export type QueryStyleDisabled<
  Collection extends string,
  Member extends QueryStyleMember,
  Style extends QueryStyle,
> = `${Collection}.${Member} is unavailable because content-query.config sets queryStyle to "${Style}".`;

/**
 * Checks whether a configured or manifest value names a supported query style.
 *
 * @param value - The untrusted `queryStyle` value.
 * @returns `true` for `"fluent"` or `"relational"`.
 */
export function isQueryStyle(value: unknown): value is QueryStyle {
  return value === "fluent" || value === "relational";
}

/**
 * Finds the style that owns a collection member.
 *
 * @param member - A gated collection member.
 * @returns The style whose queries start at that member.
 */
export function styleOfMember(member: QueryStyleMember): QueryStyle {
  return (queryStyleMembers.fluent as readonly string[]).includes(member) ? "fluent" : "relational";
}

/**
 * Formats the runtime message that matches {@link QueryStyleDisabled}.
 *
 * @param collection - The queried collection.
 * @param member - The disabled member.
 * @param style - The only style the configuration allows.
 * @returns The error message.
 */
export function queryStyleDisabledMessage<
  Collection extends string,
  Member extends QueryStyleMember,
  Style extends QueryStyle,
>(
  collection: Collection,
  member: Member,
  style: Style,
): QueryStyleDisabled<Collection, Member, Style> {
  return `${collection}.${member} is unavailable because content-query.config sets queryStyle to "${style}".`;
}
