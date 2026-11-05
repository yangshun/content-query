import type { CollectionRegistry, LoadedMarker } from "../collection/types.ts";
import type { InvalidRelationships } from "../collection/registry-types.ts";
import type {
  RelationalCollectionQueries,
  RelationalCountOptions,
} from "../query/relational-types.ts";
import type { Query } from "../query/types.ts";
import type { MembersOf, QueryStyle, QueryStyleDisabled, QueryStyleMember } from "./query-style.ts";

declare const collectionType: unique symbol;

/**
 * The registry a query scope sees: only the loaded collections, each marked so it offers only the
 * relationships into loaded collections.
 */
export type LoadedRegistry<
  Registry extends CollectionRegistry,
  Loaded extends keyof Registry & string,
> = { [Name in Loaded]: Registry[Name] & LoadedMarker<Loaded> };

/** The members that start a fluent query; terminals such as `all()` follow one of them. */
type FluentMember = MembersOf<"fluent">;
/** The relational members, apart from `count`, which both styles share. */
type RelationalMember = "findMany" | "findFirst" | "paginate";

/** Fluent starters that only a collection handle offers, not a query builder. */
type HandleStarters<Registry extends CollectionRegistry, Name extends keyof Registry & string> = {
  /**
   * Starts a query for the entry with this ID. Select its data as usual; awaiting the query, or
   * calling `first()` or `execute()`, returns the entry or `undefined`. Later `where()` filters
   * also apply. Lookups use the collection's ID index.
   *
   * @param id - The entry's ID.
   * @returns A single-entry root query, without ordering, pagination, `all()`, or results-scope
   * adjacency.
   */
  byId(id: string): Query<Registry, Name, {}, false, false>;
};

/** Every member before `queryStyle` gating. */
type CollectionMethods<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = Pick<Query<Registry, Name>, FluentMember & keyof Query<Registry, Name>> &
  HandleStarters<Registry, Name> &
  RelationalCollectionQueries<Registry, Name>;

/**
 * Members outside the allowed style. Calls report the message as the required `this` type,
 * whatever arguments they pass.
 */
type DisabledMembers<Name extends string, Style extends QueryStyle> = {
  readonly [Member in Exclude<FluentMember | RelationalMember, MembersOf<Style>>]: (
    this: QueryStyleDisabled<Name, Member & QueryStyleMember, Style>,
    ...arguments_: readonly unknown[]
  ) => never;
};

/** `count()` counts every entry in both styles; options take relational filters. */
type CountMember<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Style extends QueryStyle,
> = [Style] extends ["fluent"]
  ? {
      /** Counts every entry. Count filtered entries with `where(...).count()`. */
      count(): Promise<number>;
    }
  : {
      /** Counts matching entries before pagination, like the fluent `count()` terminal. */
      count(options?: RelationalCountOptions<Registry, Name>): Promise<number>;
    };

/** Reads the collections a collection handle loads. */
type LoadedOf<Handle> = Handle extends { readonly [collectionType]: { loaded: infer Loaded } }
  ? Loaded
  : never;

/** Any collection handle, as `using()` accepts it. */
export type AnyCollection = { readonly [collectionType]: { loaded: string } };

/**
 * One collection's query API, as its generated entry exports it.
 *
 * Queries load only this collection and the collections passed to `using()`. Relationships into
 * any other collection are type errors here and `invalid-query` errors at runtime. `Style` narrows
 * the members to the `queryStyle` exported by content-query.config; the default allows both.
 *
 * @typeParam Registry - The configured collection registry.
 * @typeParam Name - The queried collection.
 * @typeParam Style - The allowed query style.
 * @typeParam Loaded - The collections this handle loads, including `Name`.
 */
export type Collection<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Style extends QueryStyle = QueryStyle,
  Loaded extends keyof Registry & string = Name,
> =
  InvalidRelationships<Registry> extends never
    ? Pick<
        CollectionMethods<LoadedRegistry<Registry, Loaded | Name>, Name>,
        Extract<FluentMember | RelationalMember, MembersOf<Style>>
      > &
        DisabledMembers<Name, Style> &
        CountMember<LoadedRegistry<Registry, Loaded | Name>, Name, Style> & {
          /**
           * Supplies other collections, so this collection's queries can follow relationships
           * into them. Nested relationships need each collection they reach.
           *
           * @param collections - Collections imported from their own entries.
           * @returns A handle over this collection that also loads the supplied collections.
           */
          using<const Supplied extends readonly AnyCollection[]>(
            ...collections: Supplied
          ): Collection<
            Registry,
            Name,
            Style,
            Loaded | (LoadedOf<Supplied[number]> & keyof Registry & string)
          >;
          readonly [collectionType]: { readonly name: Name; readonly loaded: Loaded | Name };
        }
    : { readonly invalidRelationships: InvalidRelationships<Registry> };

/** One handle per collection, keyed by collection name, each loading only its own collection. */
export type CollectionHandles<
  Registry extends CollectionRegistry,
  Style extends QueryStyle = QueryStyle,
> = { readonly [Name in keyof Registry & string]: Collection<Registry, Name, Style> };
