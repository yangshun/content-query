---
title: Errors and troubleshooting
description: Understand validation, query, rendering, and preparation failures.
section: reference
order: 55
---

## Content errors

Import `ContentError` from `content-query/runtime`. Inspect its stable `code` and contextual `diagnostics`, including collection, entry, source, field path, and underlying cause where available.

Codes include `source-error`, `validation-error`, `duplicate-id`, `invalid-reference`, `invalid-query`, `entry-not-found`, `not-renderable`, `artifact-error`, and `render-error`.

## Common checks

- **Missing collection types:** run preparation and include `.content-query/**/*.d.ts` in `tsconfig.json`.
- **Invalid row query:** explicitly select fields at the root and in every requested relationship scope.
- **Invalid reference:** check that the authored value identifies a valid target with the declared cardinality.
- **Client import rejected:** move the content query into a server loader, server function, or Server Component.
- **Content stays invalid:** fix the reported source or configuration error; development watches recover after a valid preparation.

Missing entries from `first()` and `findFirst()` return `undefined`. `readBody()` and `render()` reject missing entries, so handle page-not-found behavior in your application.
