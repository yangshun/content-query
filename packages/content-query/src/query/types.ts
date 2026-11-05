import type {
  CollectionRegistry,
  PayloadsOf,
  QueryData,
  Relationship,
  RelationshipsOf,
  VariantOf,
} from "../collection/types.ts";
import type { Expression, NO_SELECTION_MESSAGE, PAGINATE_AFTER_LIMIT_MESSAGE } from "./plan.ts";

declare const queryType: unique symbol;
/** Running an unselected query reports the explicit-selection rule as its required `this` type. */
type UnselectedTerminal = (
  this: typeof NO_SELECTION_MESSAGE,
  ...arguments_: readonly unknown[]
) => never;
/** A `then` that cannot resolve a value, so awaiting an unselected query fails to compile. */
type UnselectedThen = (selectBeforeAwaiting: typeof NO_SELECTION_MESSAGE) => never;
declare const fieldType: unique symbol;
export type Field<Value> = { readonly name: string; readonly [fieldType]: Value };
export type Fields<Data> = { readonly [Name in keyof Data]-?: Field<Data[Name]> };
declare const relationTarget: unique symbol;
/** A relationship in a fluent `where()` callback, filtered with `has()`. */
export type RelationField<TargetFields> = {
  readonly name: string;
  readonly [relationTarget]: TargetFields;
};
/** Fields and relationships available to a fluent `where()` callback. */
export type QueryFields<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = Fields<QueryData<Registry[Name]>> & {
  readonly [Key in keyof RelationshipsOf<Registry[Name]> & string]-?: RelationField<
    QueryFields<Registry, RelatedName<Registry, RelationOf<Registry, Name, Key>>>
  >;
};
export type Scalar = string | number | bigint | boolean | Date | null | undefined;
export type ScalarField<Value> = Field<Value> & ([Value] extends [Scalar] ? unknown : never);
export type Ordered<Value> =
  NonNullable<Value> extends string
    ? unknown
    : NonNullable<Value> extends number
      ? unknown
      : NonNullable<Value> extends bigint
        ? unknown
        : NonNullable<Value> extends Date
          ? unknown
          : never;
export type SortKey<Data> = {
  [Name in keyof Data]-?: Ordered<Data[Name]> extends never
    ? NonNullable<Data[Name]> extends boolean
      ? Name
      : never
    : Name;
}[keyof Data] &
  string;

type QueryInfo<
  Result = unknown,
  Selected extends boolean = boolean,
  Filtered extends boolean = boolean,
> = {
  readonly [queryType]: { result: Result; selected: Selected; filtered: Filtered };
};
type Simplify<Value> = { [Key in keyof Value]: Value[Key] };
/** Adds one requested payload to a result's `_payloads`, keeping earlier requests. */
type WithPayload<Result, Key extends PropertyKey, Value> = Omit<Result, "_payloads"> & {
  _payloads: Simplify<
    (Result extends { _payloads: infer Existing } ? Existing : {}) & { [Name in Key]: Value }
  >;
};
type ResultOf<Configured> = Configured extends QueryInfo<infer Result> ? Result : never;
type FilteredOf<Configured> =
  Configured extends QueryInfo<unknown, boolean, infer Filtered> ? Filtered : false;
type RelationOf<
  Registry extends CollectionRegistry,
  Name extends keyof Registry,
  Key extends keyof RelationshipsOf<Registry[Name]>,
> = RelationshipsOf<Registry[Name]>[Key] & Relationship;
type RelatedName<
  Registry extends CollectionRegistry,
  Relation extends Relationship,
> = Relation["collection"] & keyof Registry & string;
/** Applies declared relationship cardinality, optional reference fields, and filtering to a result. */
export type RelationshipResult<
  Definition,
  Relation extends Relationship,
  Result,
  Filtered extends boolean = false,
> = Relation["type"] extends "many"
  ? Result[]
  :
      | Result
      | (Filtered extends true
          ? null
          : Relation["referenceSide"] extends "from"
            ? Relation["from"] extends keyof QueryData<Definition>
              ? null extends QueryData<Definition>[Relation["from"]]
                ? null
                : undefined extends QueryData<Definition>[Relation["from"]]
                  ? null
                  : never
              : null
            : null);
type RelationValue<Definition, Relation extends Relationship, Configured> = RelationshipResult<
  Definition,
  Relation,
  ResultOf<Configured>,
  FilteredOf<Configured>
>;
export type Query<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Result = {},
  Selected extends boolean = false,
  Many extends boolean = true,
  Root extends boolean = true,
  Filtered extends boolean = false,
  AllowAdjacent extends boolean = true,
  Pagination extends boolean = true,
  Paged extends boolean = false,
> = QueryInfo<Result, Selected, Filtered> & {
  select<
    const Keys extends readonly [
      keyof QueryData<Registry[Name]> & string,
      ...(keyof QueryData<Registry[Name]> & string)[],
    ],
  >(
    ...keys: Keys
  ): Query<
    Registry,
    Name,
    {
      [
        Key in Exclude<keyof Result, keyof QueryData<Registry[Name]>> | Keys[number]
      ]: Key extends Keys[number]
        ? QueryData<Registry[Name]>[Key & keyof QueryData<Registry[Name]>]
        : Key extends keyof Result
          ? Result[Key]
          : never;
    },
    true,
    Many,
    Root,
    Filtered,
    AllowAdjacent,
    Pagination,
    Paged
  >;
  where(
    configure: (fields: QueryFields<Registry, Name>) => Expression,
  ): Query<Registry, Name, Result, Selected, Many, Root, true, AllowAdjacent, Pagination, Paged>;
  with<
    Key extends keyof RelationshipsOf<Registry[Name]> & string,
    Configured extends QueryInfo<unknown, true>,
  >(
    name: Key,
    configure: (
      query: Query<
        Registry,
        RelatedName<Registry, RelationOf<Registry, Name, Key>>,
        {},
        false,
        RelationOf<Registry, Name, Key>["type"] extends "many" ? true : false,
        false,
        false,
        AllowAdjacent
      >,
    ) => Configured,
  ): Query<
    Registry,
    Name,
    Result & {
      [Property in Key]: RelationValue<Registry[Name], RelationOf<Registry, Name, Key>, Configured>;
    },
    true,
    Many,
    Root,
    Filtered,
    AllowAdjacent,
    Pagination,
    Paged
  >;
} & (Many extends true
    ? {
        orderBy(
          field: SortKey<QueryData<Registry[Name]>>,
          direction?: "asc" | "desc",
        ): Query<
          Registry,
          Name,
          Result,
          Selected,
          Many,
          Root,
          Filtered,
          AllowAdjacent,
          Pagination,
          Paged
        >;
      }
    : {}) &
  (Many extends true
    ? Pagination extends true
      ? {
          limit(
            value: number,
          ): Query<
            Registry,
            Name,
            Result,
            Selected,
            Many,
            Root,
            Filtered,
            AllowAdjacent,
            Pagination,
            true
          >;
          offset(
            value: number,
          ): Query<
            Registry,
            Name,
            Result,
            Selected,
            Many,
            Root,
            Filtered,
            AllowAdjacent,
            Pagination,
            true
          >;
        }
      : {}
    : {}) &
  (AllowAdjacent extends true
    ? {
        /** Attaches a payload under `_payloads` after filtering, ordering, and pagination. */
        withPayload<Key extends keyof PayloadsOf<Registry[Name]> & string>(
          name: Key,
          ...variant: keyof VariantOf<Registry[Name], Key> extends never
            ? []
            : [variant: Readonly<VariantOf<Registry[Name], Key>>]
        ): Query<
          Registry,
          Name,
          WithPayload<Result, Key, PayloadsOf<Registry[Name]>[Key]>,
          true,
          Many,
          Root,
          Filtered,
          AllowAdjacent,
          Pagination,
          Paged
        >;
        /** Selects neighbor fields within this scope's filtered and ordered results. */
        selectAdjacent<
          const Keys extends readonly [
            keyof QueryData<Registry[Name]> & string,
            ...(keyof QueryData<Registry[Name]> & string)[],
          ],
        >(
          ...fields: Keys
        ): Query<
          Registry,
          Name,
          Result & {
            _adjacent: Adjacent<{
              [Key in Keys[number]]: QueryData<Registry[Name]>[Key &
                keyof QueryData<Registry[Name]>];
            }>;
          },
          true,
          Many,
          Root,
          Filtered,
          AllowAdjacent,
          Pagination,
          Paged
        >;
        selectAdjacent<Configured extends QueryInfo<unknown, true>>(
          configure: (
            siblings: Query<Registry, Name, {}, false, true, false, false, false, false>,
          ) => Configured,
        ): Query<
          Registry,
          Name,
          Result & { _adjacent: Adjacent<ResultOf<Configured>> },
          true,
          Many,
          Root,
          Filtered,
          AllowAdjacent,
          Pagination,
          Paged
        >;
        selectAdjacent<const Options extends AdjacentOptions<Registry, Name>>(
          options: Options & CheckedOptions<Registry, Name, NoInfer<Options>, true, false, false>,
        ): Query<
          Registry,
          Name,
          Result & { _adjacent: Adjacent<SelectionResult<Registry, Name, Options["select"]>> },
          true,
          Many,
          Root,
          Filtered,
          AllowAdjacent,
          Pagination,
          Paged
        >;
      }
    : {}) &
  (Root extends true
    ? {
        all: Selected extends true ? () => Promise<Simplify<Result>[]> : UnselectedTerminal;
        execute: Selected extends true ? () => Promise<Simplify<Result>[]> : UnselectedTerminal;
        then: Selected extends true ? Promise<Simplify<Result>[]>["then"] : UnselectedThen;
        first: Selected extends true
          ? () => Promise<Simplify<Result> | undefined>
          : UnselectedTerminal;
        /** Counts matching entries without a selection; unavailable once payloads are requested. */
        count: [Result] extends [never]
          ? () => Promise<number>
          : [Result] extends [{ _payloads: unknown }]
            ? never
            : () => Promise<number>;
        /**
         * Returns one page from one revision: `{ page, size }` for page numbers, or
         * `{ size, after?, before?, total? }` for cursors. Unavailable after `limit()` or `offset()`.
         */
        paginate: Selected extends true
          ? [Paged] extends [true]
            ? PaginateAfterLimit
            : Paginate<Simplify<Result>>
          : UnselectedTerminal;
      }
    : {});

/** `paginate()` after `limit()` or `offset()` reports why as its required `this` type. */
type PaginateAfterLimit = (
  this: typeof PAGINATE_AFTER_LIMIT_MESSAGE,
  ...arguments_: readonly unknown[]
) => never;
/** The `paginate()` overloads for one item type. */
export type Paginate<Item> = {
  (options: PageOptions): Promise<NumberedPage<Item>>;
  (options: CursorOptions & { total: true }): Promise<CursorPage<Item, true>>;
  (options: CursorOptions): Promise<CursorPage<Item>>;
};
/** Page-number pagination: `page` starts at 1 and `size` is the number of entries per page. */
export type PageOptions = {
  page: number;
  size: number;
  after?: never;
  before?: never;
  total?: never;
};
/**
 * Cursor pagination. `after` continues from an earlier page's `endCursor`; `before` returns the
 * entries just before a `startCursor`. A `null` cursor starts at the first entry (`after`) or the
 * last entry (`before`). `total: true` adds the matching total.
 */
export type CursorOptions = { size: number; page?: never; total?: boolean } & (
  | { after?: string | null; before?: never }
  | { before?: string | null; after?: never }
);
/** Options accepted by `paginate()`. */
export type PaginateOptions = PageOptions | CursorOptions;
/** Option names that `paginate()` reads alongside relational query options. */
export type PaginateKey = keyof PageOptions;
/** One numbered page and where it sits among every matching entry. */
export type NumberedPage<Item> = {
  items: Item[];
  /** Matching entries across every page. */
  total: number;
  page: number;
  /** At least 1: the first page exists even when nothing matches. */
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};
/** One cursor page. Both cursors are `null` when the page is empty. */
export type CursorPage<Item, Total extends boolean = false> = {
  items: Item[];
  /** Pass as `before` for the previous page. */
  startCursor: string | null;
  /** Pass as `after` for the next page. */
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
} & (Total extends true ? { total: number } : {});
/** The page type `paginate()` returns for the given options. */
export type PaginateResult<Item, Options> = Options extends { page: number }
  ? NumberedPage<Item>
  : CursorPage<Item, Options extends { total: true } ? true : false>;

export type Adjacent<Entry> = { previous: Entry | null; next: Entry | null };
type PresenceFilter = { isNull?: boolean; isUndefined?: boolean; isMissing?: boolean };
type ScalarFilter<Value> = {
  equals?: Value;
  not?: Value | ScalarFilter<Value>;
  in?: readonly Value[];
  notIn?: readonly Value[];
} & (Ordered<Value> extends never
  ? {}
  : {
      gt?: NonNullable<Value>;
      gte?: NonNullable<Value>;
      lt?: NonNullable<Value>;
      lte?: NonNullable<Value>;
    }) &
  (NonNullable<Value> extends string
    ? { contains?: string; startsWith?: string; endsWith?: string }
    : {});
type FieldFilter<Value> = PresenceFilter &
  (NonNullable<Value> extends readonly (infer Item)[]
    ? Item extends Scalar
      ? { has?: Item; hasSome?: readonly Item[]; hasEvery?: readonly Item[] }
      : {}
    : [Value] extends [Scalar]
      ? ScalarFilter<Value>
      : {});
export type Where<Data> = {
  [Name in keyof Data]?: [Data[Name]] extends [Scalar]
    ? Data[Name] | FieldFilter<Data[Name]>
    : FieldFilter<Data[Name]>;
} & {
  AND?: Where<Data> | readonly Where<Data>[];
  OR?: readonly Where<Data>[];
  NOT?: Where<Data> | readonly Where<Data>[];
};
export type OrderBy<Data> = Partial<Record<SortKey<Data>, "asc" | "desc">>;
type ObjectScope<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Many extends boolean,
> = {
  where?: Where<QueryData<Registry[Name]>> | ((fields: QueryFields<Registry, Name>) => Expression);
} & (Many extends true
  ? {
      orderBy?: OrderBy<QueryData<Registry[Name]>> | readonly OrderBy<QueryData<Registry[Name]>>[];
      limit?: number;
      offset?: number;
    }
  : {});
export type QueryOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Many extends boolean = true,
  AllowAdjacent extends boolean = true,
> = ObjectScope<Registry, Name, Many> & {
  select: Selection<Registry, Name, AllowAdjacent>;
};
export type CountOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = ObjectScope<Registry, Name, true>;
export type AdjacentOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = Omit<QueryOptions<Registry, Name, true, false>, "limit" | "offset">;
export type Selection<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  AllowAdjacent extends boolean = true,
> = {
  [Field in keyof QueryData<Registry[Name]>]?: boolean;
} & {
  [Key in keyof RelationshipsOf<Registry[Name]>]?:
    | QueryOptions<
        Registry,
        RelatedName<Registry, RelationOf<Registry, Name, Key>>,
        RelationOf<Registry, Name, Key>["type"] extends "many" ? true : false,
        AllowAdjacent
      >
    | false;
} & (AllowAdjacent extends true
    ? {
        _adjacent?:
          | { scope: "results"; select: Selection<Registry, Name, false> }
          | (AdjacentOptions<Registry, Name> & { scope?: "collection" });
      }
    : {});
type ObjectRelationValue<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Key extends keyof RelationshipsOf<Registry[Name]>,
  Options,
> = Options extends { select: infer Projection }
  ? RelationValue<
      Registry[Name],
      RelationOf<Registry, Name, Key>,
      QueryInfo<
        SelectionResult<
          Registry,
          RelatedName<Registry, RelationOf<Registry, Name, Key>>,
          Projection
        >,
        true,
        "where" extends keyof Options ? true : false
      >
    >
  : never;
export type SelectionResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Projection,
> = {
  -readonly [
    Key in keyof Projection as Projection[Key] extends false | undefined ? never : Key
  ]-?: Key extends "_adjacent"
    ? Projection[Key] extends { select: infer Neighbors }
      ? Adjacent<SelectionResult<Registry, Name, Neighbors>>
      : never
    : Key extends keyof RelationshipsOf<Registry[Name]>
      ? ObjectRelationValue<Registry, Name, Key, Projection[Key]>
      : Key extends keyof QueryData<Registry[Name]>
        ? QueryData<Registry[Name]>[Key]
        : never;
};

type CheckedField<Value, Filter> = Filter extends Scalar
  ? Filter
  : {
      [Operator in keyof Filter]: Operator extends keyof FieldFilter<Value>
        ? Operator extends "not"
          ? CheckedField<Value, Filter[Operator]>
          : Filter[Operator]
        : never;
    };
type CheckedWhereList<Data, Filters extends readonly unknown[]> = {
  [Index in keyof Filters]: CheckedWhere<Data, Filters[Index]>;
};
type CheckedWhere<Data, Filter> = Filter extends (...arguments_: never[]) => unknown
  ? Filter
  : {
      [Key in keyof Filter]: Key extends "AND" | "OR" | "NOT"
        ? Filter[Key] extends readonly unknown[]
          ? CheckedWhereList<Data, Filter[Key]>
          : CheckedWhere<Data, Filter[Key]>
        : Key extends keyof Data
          ? CheckedField<Data[Key], Filter[Key]>
          : never;
    };
type CheckedSelection<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Projection,
  AllowAdjacent extends boolean,
> = {
  [Key in keyof Projection]: Key extends "_adjacent"
    ? AllowAdjacent extends true
      ? Projection[Key] extends { scope: "results" }
        ? {
            [Option in keyof Projection[Key]]: Option extends "scope"
              ? "results"
              : Option extends "select"
                ? CheckedSelection<Registry, Name, Projection[Key][Option], false>
                : never;
          }
        : CheckedOptions<Registry, Name, Omit<Projection[Key], "scope">, true, false, false> & {
            scope?: "collection";
          }
      : never
    : Key extends keyof RelationshipsOf<Registry[Name]>
      ? Projection[Key] extends false
        ? false
        : CheckedOptions<
            Registry,
            RelatedName<Registry, RelationOf<Registry, Name, Key>>,
            Projection[Key],
            RelationOf<Registry, Name, Key>["type"] extends "many" ? true : false,
            AllowAdjacent
          >
      : Key extends keyof QueryData<Registry[Name]>
        ? Projection[Key]
        : never;
};
/** Rejects extra properties throughout inferred options, including recursive neighbor projections. */
export type CheckedOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
  Many extends boolean = true,
  AllowAdjacent extends boolean = true,
  Pagination extends boolean = true,
> = {
  [Key in keyof Options]: Key extends "select"
    ? CheckedSelection<Registry, Name, Options[Key], AllowAdjacent>
    : Key extends "where"
      ? CheckedWhere<QueryData<Registry[Name]>, Options[Key]>
      : Key extends "limit" | "offset"
        ? Pagination extends true
          ? Many extends true
            ? Options[Key]
            : never
          : never
        : Key extends keyof ObjectScope<Registry, Name, Many>
          ? Options[Key]
          : never;
};
