---
title: Custom payloads
description: Resolve large per-entry data during the build and load it only when a query asks for it.
section: defining-content
order: 14
---

Metadata is what lists, filters, and sorting need. Some entries also carry larger data that only a detail page reads, such as an exercise's hints in each language. Declare that data as a payload. ContentQuery resolves and validates it during preparation, stores each value in its own module, and loads it only when a query requests it.

## Declare a payload

Each payload has a `schema` and a `resolve()` function:

```ts
import { defineCollection } from "content-query";
import { glob } from "content-query/loaders";
import { schema } from "content-query/schema";

const coding = defineCollection({
  loader: glob({
    base: "./content/coding",
    pattern: "*/exercise.json",
    generateId: ({ entry }) => entry.split("/")[0]!,
  }),
  schema: schema.object({ title: schema.string(), locales: schema.array(schema.string()) }),
  payloads: {
    detail: {
      schema: schema.object({ hints: schema.string() }),
      variants: { locale: "locales" },
      resolve: async ({ files, variant }) => ({
        hints: await files.text(`hints/${variant.locale}.md`),
      }),
    },
    walkthrough: {
      schema: schema.string(),
      resolve: ({ files }) => files.text("walkthrough.md"),
    },
  },
});
```

A resolver receives the entry's `collection`, `id`, `data` (validated metadata plus [computed fields](/docs/computed-fields)), loader `source` metadata, the `variant` being resolved, `readBody()`, tracked `files` helpers, and an abort `signal`. Its result is validated against the payload's schema and must use the same serializable values as metadata.

Payload names cannot start with `_`, which built-in payloads such as `_rendered` use, and cannot repeat a computed field or relationship name.

## Read related files

Resolvers read files beside the entry through `files`, so ContentQuery knows what each payload variant depends on:

| Helper                            | Reads                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `files.text(path)`                | A file as UTF-8 text                                                                      |
| `files.bytes(path)`               | A file's bytes                                                                            |
| `files.glob({ pattern, schema })` | Matching files, parsed like `glob()`: frontmatter and bodies for Markdown, data otherwise |
| `files.file(path, { schema })`    | One data file's records, parsed like `file()`                                             |
| `files.renderMarkdown(body)`      | Nothing; renders Markdown like a loader's `renderMarkdown()`                              |

Paths are relative to the entry's folder: the folder of a `glob()` or `file()` entry's file, or the `source.directory` a custom loader sets. They must stay inside that folder or a directory listed in the collection's `sharedFiles` option, which `..` paths can reach:

```ts
const coding = defineCollection({
  // ...
  sharedFiles: ["./content/coding/_shared"],
  payloads: {
    harness: {
      schema: schema.string(),
      resolve: ({ files }) => files.text("../_shared/harness.ts"),
    },
  },
});
```

A `schema` validates each file's data, and a failure names that file and field. `files.glob()` and `files.file()` return entries shaped like loader entries: `{ id, data, body?, filePath }`.

## Variants

A payload can vary by keys such as a locale. Each key lists its values in one of two ways:

- Name a string-array field of the entry's data, including a computed field, to read values per entry. A missing field means the entry has no values for that key.
- Give a fixed list, such as `["easy", "hard"]`.

ContentQuery resolves every combination of the keys' values. To resolve only some combinations, return them from `combinations()`:

```ts
variants: { locale: "locales", level: ["easy", "hard"] },
combinations: ({ variants }) => variants.locale.map((locale) => ({ locale, level: "easy" })),
```

Derive values that need logic in a computed field, then name that field.

## Request a payload

Request payloads by name from the collection's [generated entry](/docs/querying-content). A payload with variants needs every variant key; a payload without variants takes `true`:

```ts
import { coding } from "content-query:collections/coding";

const exercise = await coding.findFirst({
  where: { id: "two-sum" },
  columns: { title: true },
  payloads: { detail: { locale: "fr-FR" }, walkthrough: true },
});
const hints = exercise?._payloads.detail.hints;

const sameExercise = await coding
  .byId("two-sum")
  .select("title")
  .withPayload("detail", { locale: "fr-FR" })
  .withPayload("walkthrough");
```

Each request loads only the modules it names, and catalog queries load none. Requesting a combination that an entry lacks, such as `fr-FR` for an exercise with only English hints, rejects with `variant-not-found`. The error's `payload` and `variant` properties name what was missing.

## Types

Payload values and variant keys are inferred from the declaration, so queries check payload names and variant keys. The collection's entry also exports a [payload type](/docs/reference/runtime#generated-types) named after the collection:

```ts
import type { ContentCodingPayload } from "content-query:collections/coding";

type Detail = ContentCodingPayload<"detail">; // { hints: string }
```

`content-query` exports `PayloadData` and `VariantOf` for helpers that take a collection definition.

## Errors

A resolver failure or schema violation fails preparation. Each diagnostic names the collection, entry, source, `payload`, and `variant`, plus the field `path` for schema issues. The CLI prints them together, for example `coding two-sum <source path> detail[locale=fr-FR] at hints`. See [errors](/docs/reference/errors).

## Development updates

During development, ContentQuery records every file and glob a resolver reads through `files`. Editing `hints/fr-FR.md` resolves only the `detail[locale=fr-FR]` variant again, adding a file that a `files.glob()` pattern matches resolves the payloads that globbed it, and editing a file a computed field read prepares that entry again. Editing the entry itself, such as its `exercise.json`, prepares the entry and its payloads again.

Files read without `files`, such as through `node:fs` or a network request, are not tracked. Set `cache: false` on a payload that depends on them, and it is resolved again in every revision.
