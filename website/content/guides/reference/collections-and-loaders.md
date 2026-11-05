---
title: Collection and loader APIs
description: Public entry points for defining content and acquiring sources.
section: reference
order: 51
---

## Collection definitions

Import `defineCollection` from `content-query`. A definition contains:

- Exactly one of `source` or `loader`.
- An optional `schema` for metadata validation and precise type inference.
- Optional `computed` fields with their own schemas and resolvers.
- Optional `relationships` connecting collection fields.
- Optional [custom `payloads`](/docs/payloads): schema-validated per-entry data, with optional variants, loaded only when a query requests it.
- Optional `sharedFiles`: directories, relative to the project root, that resolvers' [`files` helpers](/docs/payloads#read-related-files) may read besides each entry's folder.
- An optional `typeName`: the singular word for [generated types](/docs/reference/runtime#generated-types), such as `"Category"` for `ContentCategory`, when dropping a trailing `s` from the collection name does not produce one.

## Built-in loaders

Import `glob` and `file` from `content-query/loaders`. `glob()` selects individual files by pattern; `file()` reads arrays or keyed objects from one file.

Source objects accept `type`, `directory`, `include`, `generateId`, `retainBody`, and `deferRender`. A string source is Markdown shorthand.

## Custom loaders

A native loader has a `name` and async `load(context)` function. Use `context.parseData()` before `context.store.set()` to validate metadata. Context also provides digests, logging, Markdown rendering, session metadata, configuration, and an optional development watcher.

A loader's type controls which [built-in payloads](/docs/rendering-content) queries can request. A plain `Loader` offers `_body` and `_rendered`. Type a loader as `BodyLoader` when its entries carry bodies that ContentQuery cannot render, such as a format the host application compiles; queries can then request only `_body`. Type it as `RecordLoader` when its entries are data records without bodies; queries can request neither. Both types are compile-time only and are exported from `content-query/loaders`.

See [sources and loaders](/docs/sources-and-loaders) for usage and [relationships](/docs/relationships) for reference declarations.
