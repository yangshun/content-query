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

## Built-in loaders

Import `glob` and `file` from `content-query/loaders`. `glob()` selects individual files by pattern; `file()` reads arrays or keyed objects from one file.

Source objects accept `type`, `directory`, `include`, `generateId`, `retainBody`, and `deferRender`. A string source is Markdown shorthand.

## Custom loaders

A native loader has a `name` and async `load(context)` function. Use `context.parseData()` before `context.store.set()` to validate metadata. Context also provides digests, logging, Markdown rendering, session metadata, configuration, and an optional development watcher.

See [sources and loaders](/docs/sources-and-loaders) for usage and [relationships](/docs/relationships) for reference declarations.
