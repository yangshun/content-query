import type { CollectionRegistry, QueryData } from "../collection/types.ts";
import { invalidQuery } from "../shared/errors.ts";
import { checkedFields } from "./clauses.ts";
import { createBuilder } from "./builder.ts";
import { emptyPlan, type QueryRegistry, type QueryRunner } from "./plan.ts";
import type { Query } from "./types.ts";

/** A selection whose collection and selected result are inferred when from() is supplied. */
export type SelectFrom<Registry extends CollectionRegistry, Keys extends readonly string[]> = {
  /** Binds the collection and rejects selected keys that are absent from its prepared data type. */
  from<Name extends keyof Registry & string>(
    collection: Name &
      (Exclude<Keys[number], keyof QueryData<Registry[NoInfer<Name>]>> extends never
        ? unknown
        : never),
  ): Query<
    Registry,
    Name,
    Keys extends readonly []
      ? QueryData<Registry[Name]>
      : {
          [Key in Keys[number]]-?: Key extends keyof QueryData<Registry[Name]>
            ? QueryData<Registry[Name]>[Key]
            : never;
        },
    true
  >;
};

/** Defers collection validation until from(), preserving the immutable selection across reuse. */
export function createSelect(
  registry: () => QueryRegistry,
  run: QueryRunner,
  fields: readonly string[],
): object {
  const selected = [...fields];
  return {
    /** Binds the current registry and prepares a reusable root query. */
    from(collection: string) {
      const current = registry();
      if (!Object.hasOwn(current, collection)) {
        invalidQuery(`Unknown collection "${collection}".`);
      }
      const plan = emptyPlan(collection);
      if (selected.length) {
        plan.select = checkedFields(current, collection, selected);
      } else {
        plan.allFields = true;
      }
      return createBuilder(current, run, plan);
    },
  };
}
