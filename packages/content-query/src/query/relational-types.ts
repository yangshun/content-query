import type {
  CollectionRegistry,
  QueryData,
  Relationship,
  RelationshipsOf,
} from "../collection/types.ts";
import type { Expression } from "./plan.ts";
import type { Adjacent, Fields, OrderBy, Ordered, Scalar, RelationshipResult } from "./types.ts";

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

/** Collection-scoped metadata queries with Drizzle-style columns, relationships, and filters. */
export type RelationalQueryOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Many extends boolean = true,
  AllowAdjacent extends boolean = true,
  Pagination extends boolean = true,
> = {
  columns?: Partial<Record<keyof QueryData<Registry[Name]>, boolean>>;
  where?: RelationalWhere<Registry, Name>;
  with?: {
    [Key in keyof RelationshipsOf<Registry[Name]>]?:
      | boolean
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
        adjacent?: true | RelationalQueryOptions<Registry, Name, true, false, false>;
      }
    : {});

/** Options accepted by the root count helper, whose result ignores sorting and pagination. */
export type RelationalCountOptions<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
> = Pick<RelationalQueryOptions<Registry, Name>, "where" | "orderBy" | "offset" | "limit">;

type ColumnResult<Data, Options> = Options extends { columns: infer Columns }
  ? keyof Columns extends never
    ? {}
    : true extends Columns[keyof Columns]
      ? {
          -readonly [Key in keyof Columns as Columns[Key] extends false | undefined
            ? never
            : Key]-?: Key extends keyof Data ? Data[Key] : never;
        }
      : Omit<
          Data,
          { [Key in keyof Columns]: Columns[Key] extends false ? Key : never }[keyof Columns]
        >
  : Data;
type IncludedResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
> = Options extends { with: infer Related }
  ? {
      -readonly [Key in keyof Related as Related[Key] extends false | undefined
        ? never
        : Key]-?: Key extends keyof RelationshipsOf<Registry[Name]>
        ? RelationshipResult<
            Registry[Name],
            RelationshipsOf<Registry[Name]>[Key] & Relationship,
            RelationalQueryResult<
              Registry,
              RelatedName<Registry, Name, Key>,
              Related[Key] extends true ? {} : Related[Key]
            >,
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
      _adjacent: Neighbors extends true
        ? Adjacent<{ id: string }>
        : Adjacent<RelationalQueryResult<Registry, Name, Neighbors>>;
    }
  : {};
type Simplify<Value> = { [Key in keyof Value]: Value[Key] };

/** Infers selected columns and relationships, preserving optional metadata in default projections. */
export type RelationalQueryResult<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Options,
> = Options extends unknown
  ? Simplify<
      ColumnResult<QueryData<Registry[Name]>, Options> &
        IncludedResult<Registry, Name, Options> &
        AdjacentResult<Registry, Name, Options>
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
          : never;
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
              ? Options[Key][Related] extends boolean
                ? Options[Key][Related]
                : CheckedRelationalOptions<
                    Registry,
                    RelatedName<Registry, Name, Related>,
                    Options[Key][Related],
                    IsMany<Registry, Name, Related>,
                    AllowAdjacent
                  >
              : never;
          }
        : Key extends "adjacent"
          ? AllowAdjacent extends true
            ? Options[Key] extends true
              ? true
              : CheckedRelationalOptions<Registry, Name, Options[Key], true, false, false>
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

/** Typed per-collection query entry points that never expose source configuration at runtime. */
export type RelationalQueries<Registry extends CollectionRegistry> = string extends keyof Registry
  ? {}
  : {
      readonly [Name in keyof Registry & string]: {
        /** Returns matching metadata rows and requested relationships. */
        findMany<const Options extends RelationalQueryOptions<Registry, Name> = {}>(
          options?: Options & CheckedRelationalOptions<Registry, Name, NoInfer<Options>>,
        ): Promise<RelationalQueryResult<Registry, Name, Options>[]>;
        /** Returns the first matching entry, or undefined when none matches. */
        findFirst<const Options extends RelationalQueryOptions<Registry, Name> = {}>(
          options?: Options & CheckedRelationalOptions<Registry, Name, NoInfer<Options>>,
        ): Promise<RelationalQueryResult<Registry, Name, Options> | undefined>;
      };
    };
