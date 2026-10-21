---
title: Query API and operators
description: Query entry points and equivalent filtering operators.
section: reference
order: 52
---

## Query methods

The fluent API starts at `content.select(...fields).from(collection)`. Builders support `where`, `with`, `orderBy`, `offset`, `limit`, and `selectAdjacent`. Await them directly or execute them with `all()`, `execute()`, `first()`, or `count()`.

The relational API exposes `content.query.posts.findMany(options?)` and `findFirst(options?)` for each registered collection. Options use `columns`, `with`, `where`, `orderBy`, `offset`, `limit`, and `adjacent`. Use `content.count(collection, options?)` for a filtered parent count before pagination.

## Selection

`content.select().from("posts")` and omitted relational `columns` return all prepared metadata. `columns: { title: true }` includes only the named fields; `columns: { draft: false }` excludes them. If any field is `true`, only `true` fields are included. `columns: {}` returns no scalar fields.

Request relationships with fluent `.with(name, configure)` or relational `with: { author: true }`. Nested relational options use the same `columns`, `with`, and `where` shapes. Many relationships also allow ordering and pagination; singular relationships allow filtering. Bodies and rendered output are separate operations.

## Filter operators

Import fluent operators from `content-query/query`.

| Fluent                                 | Relational filter                                             |
| -------------------------------------- | ------------------------------------------------------------- |
| `eq`, `ne`                             | `eq`, `ne`; scalar shorthand means equality                   |
| `gt`, `gte`, `lt`, `lte`               | Same names                                                    |
| `inArray`, `notInArray`                | `in`, `notIn`                                                 |
| `contains`, `startsWith`, `endsWith`   | Same names; literal, case-sensitive matching                  |
| Structured relational predicates       | `like`, `ilike`, `notLike`, `notIlike`; `%` and `_` wildcards |
| `arrayContains(field, item)`           | `arrayContains: [item]`                                       |
| `arrayContainsAny`, `arrayContainsAll` | `arrayOverlaps`, `arrayContains`                              |
| Structured relational predicates       | `arrayContained`                                              |
| `isNull`                               | `isNull`, `isNotNull` with boolean values                     |
| `isUndefined`, `isMissing`             | Same names with boolean values                                |
| `and`, `or`, `not`                     | `AND`, `OR`, `NOT` at query or field scope                    |

Operators are checked against field types. `ilike` ignores case; the other string patterns are case-sensitive. A backslash escapes pattern wildcards. Null, undefined, and missing properties have distinct semantics.

Relational filters can traverse declared relationships: `where: { author: { name: "Ada" } }` matches parents with a matching author. `author: true` tests existence and `author: false` tests absence. Filters inside `with` affect included relationships rather than parent membership.

For fields named `AND`, `OR`, `NOT`, or `RAW`, use `where: { RAW: (fields) => eq(fields.AND, value) }`. `RAW` accepts a structured expression callback, not a SQL string.

See [querying content](/docs/querying-content) for paired examples, relationship selection, and adjacency.
