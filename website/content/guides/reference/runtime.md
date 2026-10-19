---
title: Runtime API
description: Consume prepared metadata, bodies, and rendered content on the server.
section: reference
order: 53
---

## Content operations

| Method                           | Result                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `query(collection)`              | Immutable fluent query builder                               |
| `findMany(collection, options)`  | Selected entries                                             |
| `findFirst(collection, options)` | Selected entry or `undefined`                                |
| `count(collection, options)`     | Filtered entry count before pagination                       |
| `readBody(collection, id)`       | Retained text or `undefined`; missing entries reject         |
| `render(collection, id)`         | `{ html, headings }`; missing or unrenderable entries reject |

## Generated types

Both the physical server entry and `content-query:server` export `CollectionKey`, `CollectionData<"posts">`, and `Collections` as types. `CollectionData` includes the ID, validated metadata, and computed fields.

Keep runtime imports on the server. See [querying content](/docs/querying-content) and [rendering content](/docs/rendering-content) for usage.
