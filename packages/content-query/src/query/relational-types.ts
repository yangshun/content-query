import type {
  CollectionRegistry,
  PayloadsOf,
  QueryData,
  Relationship,
  RelationshipsOf,
  SelectedData,
  UnavailableRelationship,
  VariantOf,
  VariantRequest,
} from "../collection/types.ts";
import type { Expression, NO_SELECTION_MESSAGE } from "./plan.ts";
import type {
  Adjacent,
  Fields,
  OrderBy,
  Ordered,
  PaginateKey,
  PaginateOptions,
  PaginateResult,
  Scalar,
  RelationshipResult,
} from "./types.ts";

type RelatedName<
  Registry extends CollectionRegistry,
  Name extends keyof Registry,
  Key extends keyof RelationshipsOf<Registry[Name]>,
> = (RelationshipsOf<Registry[Name]>[Key] & Relationship)["collection"] & keyof Registry & string;
type IsMany<
  Registry extends CollectionRegistry,
  Name extends keyof Registry,
  Key extends keyof RelationshipsOf<Registry[Name]>,
> = RelationshipsOf<Registry[Name]>[Key] extends { type: "many" } ? true : false;

type Condition<Value> = ([Value] extends [Scalar] ? Value : never) | FieldFilter<Value>;
type FieldFilter<Value> = {
  isNull?: boolean;
  isNotNull?: boolean;
  isUndefined?: boolean;
  isMissing?: boolean;
  AND?: readonly Condition<Value>[];
  OR?: readonly Condition<Value>[];
  NOT?: Condition<Value>;
} & ([Value] extends [Scalar]
  ? { eq?: Value; ne?: Value; in?: readonly Value[]; notIn?: readonly Value[] }
  : {}) &
  (Ordered<Value> extends never
    ? {}
    : {
        gt?: NonNullable<Value>;
        gte?: NonNullable<Value>;
        lt?: NonNullable<Value>;
        lte?: NonNullable<Value>;
      }) &
  (NonNullable<Value> extends string
    ? {
        like?: string;
        ilike?: string;
        notLike?: string;
        notIlike?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
      }
    : {}) &
  (NonNullable<Value> extends readonly (infer Item)[]
    ? Item extends Scalar
      ? {
          arrayContains?: readonly Item[];
          arrayOverlaps?: readonly Item[];
          arrayContained?: readonly Item[];
        }
      : {}
    : {});

/** Object predicates over prepared fields and existential filters over related entries. */
export type RelationalWhere<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = {
  [Key in keyof QueryData<Registry[Name]>]?: Condition<QueryData<Registry[Name]>[Key]>;
} & {
  [Key in keyof RelationshipsOf<Registry[Name]>]?:
    | boolean
    | RelationalWhere<Registry, RelatedName<Registry, Name, Key>>;
} & {
  AND?: RelationalWhere<Registry, Name> | readonly RelationalWhere<Registry, Name>[];
  OR?: readonly RelationalWhere<Registry, Name>[];
  NOT?: RelationalWhere<Registry, Name> | readonly RelationalWhere<Registry, Name>[];
  RAW?: (fields: Fields<QueryData<Registry[Name]>>) => Expression;
};

/**
 * Requests one payload: `true` without variants, or a record giving every variant key a value or
 * a nonempty list of values to try in order.
 */
export type PayloadRequest<Variant> = keyof Variant extends never ? true : VariantRequest<Variant>;
/** Payloads to attach under `_payloads`; payloads set to false are omitted. */
export type PayloadOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = {
  [Key in keyof PayloadsOf<Registry[Name]>]?:
    | false
    | PayloadRequest<VariantOf<Registry[Name], Key>>;
};
/** Rejects variant keys a payload does not declare, including through inferred variables. */
type CheckedPayloadRequest<Request, Variant> = Request extends boolean
  ? Request
  : {
      [Key in keyof Request]: Key extends keyof Variant
        ? string | readonly [string, ...string[]]
        : never;
    };

/**
 * Collection-scoped metadata queries with Drizzle-style columns, relationships, and filters.
 * Nothing is selected implicitly, not even `id`: list fields in `columns`, include relationships
 * with nested options, request payloads, or select adjacency.
 */
export type RelationalQueryOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Many extends boolean = true,
  AllowAdjacent extends boolean = true,
  Pagination extends boolean = true,
> = {
  /** Fields to include, each set to `true`. Omitted fields are never returned. */
  columns?: Partial<Record<keyof QueryData<Registry[Name]>, true>>;
  where?: RelationalWhere<Registry, Name>;
  /** Related entries to include; each selects its own data. `false` omits a relationship. */
  with?: {
    [Key in keyof RelationshipsOf<Registry[Name]>]?:
      | false
      | RelationalQueryOptions<
          Registry,
          RelatedName<Registry, Name, Key>,
          IsMany<Registry, Name, Key>,
          AllowAdjacent
        >;
  };
} & (Many extends true ? { orderBy?: OrderBy<QueryData<Registry[Name]>> } : {}) &
  (Many extends true ? (Pagination extends true ? { limit?: number; offset?: number } : {}) : {}) &
  (AllowAdjacent extends true
    ? {
        /**
         * Previous and next entries, which select their own data. `scope: "results"` finds
         * neighbors within these results; other options describe an independent sibling scope.
         */
        adjacent?:
          | ({ scope: "results" } & Pick<
              RelationalQueryOptions<Registry, Name, true, false, false>,
              "columns" | "with"
            >)
          | ({ scope?: "collection" } & RelationalQueryOptions<Registry, Name, true, false, false>);
        payloads?: PayloadOptions<Registry, Name>;
      }
    : {});

/** Options accepted by relational `paginate()`: query options without limit or offset, plus a page request. */
export type RelationalPaginateOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = RelationalQueryOptions<Registry, Name, true, true, false> & PaginateOptions;

/** Options accepted by the root count helper, whose result ignores sorting and pagination. */
export type RelationalCountOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = Pick<RelationalQueryOptions<Registry, Name>, "where" | "orderBy" | "offset" | "limit">;

type ColumnResult<Data, Options> = Options extends { columns: infer Columns }
  ? SelectedData<
      Data,
      { [Key in keyof Columns]-?: Columns[Key] extends true ? Key : never }[keyof Columns] &
        keyof Data
    >
  : {};
/** Keys whose option values request something, as opposed to `false` or `undefined`. */
type Requested<Map> = keyof {
  [Key in keyof Map as Map[Key] extends false | undefined ? never : Key]: unknown;
};
/** Whether options select fields, include relationships, request payloads, or select adjacency. */
type SelectsData<Options> =
  | (Options extends { columns: infer Columns } ? Requested<Columns> : never)
  | (Options extends { with: infer Related } ? Requested<Related> : never)
  | (Options extends { payloads: infer Payloads } ? Requested<Payloads> : never)
  | (Options extends { adjacent: infer Neighbors }
      ? Neighbors extends false | undefined
        ? never
        : "adjacent"
      : never) extends never
  ? false
  : true;
/**
 * Requires a row-returning scope to request data. An unselected scope must supply an impossible
 * property named after the rule, so the compiler error states it.
 */
export type SelectionRequired<Options> =
  SelectsData<Options> extends true ? unknown : { [Rule in typeof NO_SELECTION_MESSAGE]: never };
type IncludedResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
> = Options extends { with: infer Related }
  ? {
      -readonly [
        Key in keyof Related as Related[Key] extends false | undefined ? never : Key
      ]-?: Key extends keyof RelationshipsOf<Registry[Name]>
        ? RelationshipResult<
            Registry[Name],
            RelationshipsOf<Registry[Name]>[Key] & Relationship,
            RelationalQueryResult<Registry, RelatedName<Registry, Name, Key>, Related[Key]>,
            "where" extends keyof Related[Key] ? true : false
          >
        : never;
    }
  : {};
type AdjacentResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
> = Options extends { adjacent: infer Neighbors }
  ? {
      _adjacent: Adjacent<RelationalQueryResult<Registry, Name, Neighbors>>;
    }
  : {};
type Simplify<Value> = { [Key in keyof Value]: Value[Key] };
type RequestedPayloads<Payloads, Requested> = {
  -readonly [
    Key in keyof Requested as Requested[Key] extends false | undefined ? never : Key
  ]-?: Key extends keyof Payloads ? Payloads[Key] : never;
};
type PayloadResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
> = Options extends { payloads: infer Requested }
  ? keyof RequestedPayloads<PayloadsOf<Registry[Name]>, Requested> extends never
    ? {}
    : { _payloads: Simplify<RequestedPayloads<PayloadsOf<Registry[Name]>, Requested>> }
  : {};

/** Infers exactly the selected columns, relationships, adjacency, and payloads. */
export type RelationalQueryResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
> = Options extends unknown
  ? Simplify<
      ColumnResult<QueryData<Registry[Name]>, Options> &
        IncludedResult<Registry, Name, Options> &
        AdjacentResult<Registry, Name, Options> &
        PayloadResult<Registry, Name, Options>
    >
  : never;

type CheckedConditions<Value, Filters extends readonly unknown[]> = {
  [Index in keyof Filters]: CheckedCondition<Value, Filters[Index]>;
};
type CheckedCondition<Value, Filter> = Filter extends Scalar
  ? Filter
  : {
      [Key in keyof Filter]: Key extends "AND" | "OR"
        ? Filter[Key] extends readonly unknown[]
          ? CheckedConditions<Value, Filter[Key]>
          : never
        : Key extends "NOT"
          ? CheckedCondition<Value, Filter[Key]>
          : Key extends keyof FieldFilter<Value>
            ? Filter[Key]
            : never;
    };
type CheckedWhereList<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Filters extends readonly unknown[],
> = {
  [Index in keyof Filters]: CheckedWhere<Registry, Name, Filters[Index]>;
};
type CheckedWhere<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Filter,
> = {
  [Key in keyof Filter]: Key extends "AND" | "OR" | "NOT"
    ? Filter[Key] extends readonly unknown[]
      ? CheckedWhereList<Registry, Name, Filter[Key]>
      : CheckedWhere<Registry, Name, Filter[Key]>
    : Key extends "RAW"
      ? Filter[Key]
      : Key extends keyof RelationshipsOf<Registry[Name]>
        ? Filter[Key] extends boolean
          ? Filter[Key]
          : CheckedWhere<Registry, RelatedName<Registry, Name, Key>, Filter[Key]>
        : Key extends keyof QueryData<Registry[Name]>
          ? CheckedCondition<QueryData<Registry[Name]>[Key], Filter[Key]>
          : UnavailableRelationship<Registry[Name], Key>;
};

/** Rejects unknown options recursively, including options supplied through inferred variables. */
export type CheckedRelationalOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
  Many extends boolean = true,
  AllowAdjacent extends boolean = true,
  Pagination extends boolean = true,
> = {
  [Key in keyof Options]: Key extends "columns"
    ? {
        [Column in keyof Options[Key]]: Column extends keyof QueryData<Registry[Name]>
          ? Options[Key][Column]
          : never;
      }
    : Key extends "where"
      ? CheckedWhere<Registry, Name, Options[Key]>
      : Key extends "with"
        ? {
            [Related in keyof Options[Key]]: Related extends keyof RelationshipsOf<Registry[Name]>
              ? Options[Key][Related] extends false | undefined
                ? Options[Key][Related]
                : CheckedRelationalOptions<
                    Registry,
                    RelatedName<Registry, Name, Related>,
                    Options[Key][Related],
                    IsMany<Registry, Name, Related>,
                    AllowAdjacent
                  > &
                    SelectionRequired<Options[Key][Related]>
              : UnavailableRelationship<Registry[Name], Related>;
          }
        : Key extends "adjacent"
          ? AllowAdjacent extends true
            ? CheckedRelationalOptions<
                Registry,
                Name,
                Omit<Options[Key], "scope">,
                true,
                false,
                false
              > &
                SelectionRequired<Options[Key]> &
                (Options[Key] extends { scope: "results" }
                  ? { scope: "results"; where?: never; orderBy?: never }
                  : { scope?: "collection" })
            : never
          : Key extends "payloads"
            ? AllowAdjacent extends true
              ? {
                  [Payload in keyof Options[Key]]: Payload extends keyof PayloadsOf<Registry[Name]>
                    ? CheckedPayloadRequest<
                        Options[Key][Payload],
                        VariantOf<Registry[Name], Payload>
                      >
                    : never;
                }
              : never
            : Key extends "orderBy"
              ? Key extends keyof RelationalQueryOptions<
                  Registry,
                  Name,
                  Many,
                  AllowAdjacent,
                  Pagination
                >
                ? {
                    [Field in keyof Options[Key]]: Field extends keyof OrderBy<
                      QueryData<Registry[Name]>
                    >
                      ? Options[Key][Field]
                      : never;
                  }
                : never
              : Key extends keyof RelationalQueryOptions<
                    Registry,
                    Name,
                    Many,
                    AllowAdjacent,
                    Pagination
                  >
                ? Options[Key]
                : never;
};

/** One collection's relational queries: `findMany`, `findFirst`, and `paginate`. */
export type RelationalCollectionQueries<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = {
  /** Returns matching rows with exactly the selected data. Options must select something. */
  findMany<const Options extends RelationalQueryOptions<Registry, Name>>(
    options: Options &
      CheckedRelationalOptions<Registry, Name, NoInfer<Options>> &
      SelectionRequired<NoInfer<Options>>,
  ): Promise<RelationalQueryResult<Registry, Name, Options>[]>;
  /** Returns the first matching row, or undefined when none matches. */
  findFirst<const Options extends RelationalQueryOptions<Registry, Name>>(
    options: Options &
      CheckedRelationalOptions<Registry, Name, NoInfer<Options>> &
      SelectionRequired<NoInfer<Options>>,
  ): Promise<RelationalQueryResult<Registry, Name, Options> | undefined>;
  /**
   * Returns one page from one revision: `page` and `size` for page numbers, or `size` with
   * `after`, `before`, or `total` for cursors. `limit` and `offset` are unavailable.
   */
  paginate<const Options extends RelationalPaginateOptions<Registry, Name>>(
    options: Options &
      CheckedRelationalOptions<
        Registry,
        Name,
        NoInfer<Omit<Options, PaginateKey>>,
        true,
        true,
        false
      > &
      SelectionRequired<NoInfer<Options>>,
  ): Promise<PaginateResult<RelationalQueryResult<Registry, Name, Options>, Options>>;
};

/** Typed per-collection query entry points that never expose source configuration at runtime. */
export type RelationalQueries<Registry extends CollectionRegistry> = string extends keyof Registry
  ? {}
  : { readonly [Name in keyof Registry & string]: RelationalCollectionQueries<Registry, Name> };
