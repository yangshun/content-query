/** Query APIs an application can allow through `queryStyle` in content-query.config. */
export type QueryStyle = "fluent" | "relational";

/**
 * Root `content` members that start each query style. Every other query API hangs off these
 * members, so gating them gates payloads, relationships, and adjacency as well.
 */
export const queryStyleMembers = {
  fluent: ["from"],
  relational: ["query", "count"],
} as const satisfies Record<QueryStyle, readonly string[]>;

/** A root `content` member that belongs to exactly one query style. */
export type QueryStyleMember = (typeof queryStyleMembers)[QueryStyle][number];

/** Root members that start a query in the given style. */
export type MembersOf<Style extends QueryStyle> = (typeof queryStyleMembers)[Style][number];

/**
 * Describes a disabled root member in the type error itself, for example:
 * `content.from is unavailable because content-query.config sets queryStyle to "relational".`
 */
export type QueryStyleDisabled<
  Member extends QueryStyleMember,
  Style extends QueryStyle,
> = `content.${Member} is unavailable because content-query.config sets queryStyle to "${Style}".`;

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
 * Finds the style that owns a root member.
 *
 * @param member - A gated root `content` member.
 * @returns The style whose queries start at that member.
 */
export function styleOfMember(member: QueryStyleMember): QueryStyle {
  return (queryStyleMembers.fluent as readonly string[]).includes(member) ? "fluent" : "relational";
}

/**
 * Formats the runtime message that matches {@link QueryStyleDisabled}.
 *
 * @param member - The disabled root member.
 * @param style - The only style the configuration allows.
 * @returns The error message.
 */
export function queryStyleDisabledMessage<
  Member extends QueryStyleMember,
  Style extends QueryStyle,
>(member: Member, style: Style): QueryStyleDisabled<Member, Style> {
  return `content.${member} is unavailable because content-query.config sets queryStyle to "${style}".`;
}
