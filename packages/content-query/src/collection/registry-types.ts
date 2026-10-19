import type { CollectionRegistry, QueryData, Relationship, RelationshipsOf } from "./types.ts";

type Scalar = string | number | bigint | boolean | Date;
type Element<Value> =
  NonNullable<Value> extends readonly (infer Item)[] ? NonNullable<Item> : NonNullable<Value>;
type Compatible<Left, Right> =
  NonNullable<Left> extends readonly unknown[]
    ? NonNullable<Right> extends readonly unknown[]
      ? false
      : ScalarCompatible<Left, Right>
    : ScalarCompatible<Left, Right>;
type ScalarCompatible<Left, Right> = [Element<Left> | Element<Right>] extends [Scalar]
  ? [Element<Left>] extends [never]
    ? true
    : [Element<Right>] extends [never]
      ? true
      : [Extract<Element<Left>, Element<Right>> | Extract<Element<Right>, Element<Left>>] extends [
            never,
          ]
        ? false
        : true
  : false;
type CheckRelation<
  Registry extends CollectionRegistry,
  Name extends keyof Registry,
  Link extends Relationship,
> = Link["collection"] extends keyof Registry
  ? Link["from"] extends keyof QueryData<Registry[Name]>
    ? Link["to"] extends keyof QueryData<Registry[Link["collection"]]>
      ? Compatible<
          QueryData<Registry[Name]>[Link["from"]],
          QueryData<Registry[Link["collection"]]>[Link["to"]]
        > extends true
        ? never
        : "incompatible-relationship-fields"
      : "unknown-target-field"
    : "unknown-source-field"
  : "unknown-target-collection";

/** Registry-level relationship checks require the complete inferred collection map. */
export type InvalidRelationships<Registry extends CollectionRegistry> = {
  [Name in keyof Registry]: {
    [Link in keyof RelationshipsOf<Registry[Name]>]: RelationshipsOf<
      Registry[Name]
    >[Link] extends Relationship
      ? CheckRelation<Registry, Name, RelationshipsOf<Registry[Name]>[Link]>
      : "invalid-relationship";
  }[keyof RelationshipsOf<Registry[Name]>];
}[keyof Registry];
