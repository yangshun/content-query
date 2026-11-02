---
title: Runtime API
description: Query prepared metadata and request bodies and rendered content on the server.
section: reference
order: 53
---

## Content operations

| Property or method            | Purpose                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `select(...fields)`           | Starts a fluent query; `.from(collection)` binds its collection. No arguments selects all prepared metadata. |
| `query`                       | Collection namespace: `query.posts.findMany(options?)` and `query.posts.findFirst(options?)`.                |
| `count(collection, options?)` | Filtered parent count before pagination.                                                                     |

Await a fluent builder directly or call `.all()` / `.execute()` to return an array. `.first()` returns one entry or `undefined`; `.count()` returns the matching parent count. `from()` is available only after `select()`.

The relational namespace uses `columns`, `with`, `where`, `orderBy`, `limit`, `offset`, `adjacent`, and `payloads` options. Omitting `columns` returns all prepared metadata. Relationships, bodies, and rendered output remain explicit requests.

## Payloads

| Payload     | Value                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `_body`     | Retained text, or `undefined` when the entry has none.                                         |
| `_rendered` | `{ html, headings }`; entries without a rendering path reject the query with `not-renderable`. |

Request payloads with relational `payloads: { _rendered: true }` or fluent `.withPayload("_rendered")`. Results carry them under `_payloads`. Payloads load after filtering and pagination, from the same revision, and are unavailable in counts and adjacent entries. JSON, YAML, and TOML sources and `file()` collections offer no payloads.

## Generated types

Both the physical server entry and `content-query:server` export `CollectionKey`, `CollectionData<"posts">`, and `Collections` as types. `CollectionData` includes the ID, validated metadata, and computed fields.

Keep runtime imports on the server. See [querying content](/docs/querying-content) and [rendering content](/docs/rendering-content) for usage.
