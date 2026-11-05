---
title: Errors and troubleshooting
description: Understand validation, query, rendering, and preparation failures.
section: reference
order: 55
---

## Content errors

Import `ContentError` from `content-query/runtime`. Inspect its stable `code` and contextual `diagnostics`, including collection, entry, source, field path, payload, variant, and underlying cause where available.

Codes include `source-error`, `validation-error`, `duplicate-id`, `invalid-reference`, `invalid-query`, `invalid-cursor`, `variant-not-found`, `not-renderable`, `artifact-error`, and `render-error`. `variant-not-found` means an entry has no requested [custom payload](/docs/payloads) variant; its `payload` and `variant` properties name it. `invalid-cursor` means a [pagination cursor](/docs/querying-content#pagination) is malformed or came from a query with a different collection or sort order.

## Common checks

- **Missing collection types:** run preparation and include `.content-query/**/*.d.ts` in `tsconfig.json`.
- **Invalid row query:** explicitly select fields at the root and in every requested relationship scope.
- **Invalid cursor:** pass back a `startCursor` or `endCursor` unchanged, to a query with the same collection and `orderBy` clauses; treat the error as a request for the first page.
- **Invalid reference:** check that the authored value identifies a valid target with the declared cardinality.
- **Client import rejected:** move the content query into a server loader, server function, or Server Component.
- **Content stays invalid:** fix the reported source or configuration error; development watches recover after a valid preparation.

Missing entries from `first()` and `findFirst()` return `undefined`, including queries that request payloads, so handle page-not-found behavior in your application. A `_rendered` payload request rejects with `not-renderable` when a matching entry has no rendering path.
