---
title: Query API and operators
description: Query entry points and equivalent filtering operators.
section: reference
order: 52
---

## Query methods

The fluent API starts at `content.query(collection)`. Builders support `where`, `select`, `with`, `orderBy`, `offset`, `limit`, and `selectAdjacent`; execute them with `all()`, `first()`, or `count()`.

The object API exposes `content.findMany()`, `content.findFirst()`, and `content.count()`. Options use `where`, `select`, `orderBy`, `offset`, and `limit`.

## Filter operators

Import fluent operators from `content-query/query`.

| Fluent                                                  | Object filter                  |
| ------------------------------------------------------- | ------------------------------ |
| `eq`, `ne`                                              | `equals`, `not`                |
| `gt`, `gte`, `lt`, `lte`                                | `gt`, `gte`, `lt`, `lte`       |
| `inArray`, `notInArray`                                 | `in`, `notIn`                  |
| `contains`, `startsWith`, `endsWith`                    | Same names                     |
| `arrayContains`, `arrayContainsAny`, `arrayContainsAll` | `has`, `hasSome`, `hasEvery`   |
| `isNull`, `isUndefined`, `isMissing`                    | Same names with boolean values |
| `and`, `or`, `not`                                      | `AND`, `OR`, `NOT`             |

Operators are checked against field types. String matching is literal and case-sensitive; null, undefined, and missing properties have distinct semantics.

See [querying content](/docs/querying-content) for paired examples, relationship selection, and adjacency.
