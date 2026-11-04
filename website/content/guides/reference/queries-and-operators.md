---
title: Query API and operators
description: Query entry points and equivalent filtering operators.
section: reference
order: 52
---

## Query methods

The fluent API starts at `content.from(collection)`. Builders support `select`, `where`, `with`, `withPayload`, `orderBy`, `offset`, `limit`, and `selectAdjacent`. Await a selected builder directly or execute it with `all()`, `execute()`, or `first()`; `count()` needs no selection.

The relational API exposes `content.query.posts.findMany(options)` and `findFirst(options)` for each registered collection. Options use `columns`, `with`, `where`, `orderBy`, `offset`, `limit`, `adjacent`, and `payloads`. Use `content.count(collection, options?)` for a filtered parent count before pagination.

## Selection

Queries return only what they select; nothing is implicit, not even `id`. Every row-returning scope, including nested relationships and adjacent sibling scopes, must select fields, include a relationship, request a payload, or select adjacency. A scope that selects nothing fails to type-check and throws an `invalid-query` error.

Fluent `.select("title")` and relational `columns: { title: true }` include only the named fields. Columns accept only `true`; there are no exclusions. `columns: {}` selects no fields, for scopes that select only relationships, payloads, or adjacency.

Request relationships with fluent `.with(name, configure)` or relational `with: { author: { columns: { name: true } } }`; `with: { author: true }` is rejected because the relationship would select nothing. Nested relational options use the same `columns`, `with`, and `where` shapes. Many relationships also allow ordering and pagination; singular relationships allow filtering. Bodies and rendered output are payloads: request them with relational `payloads: { _rendered: true }` or fluent `.withPayload("_rendered")`, at the root or inside relationship scopes.

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
