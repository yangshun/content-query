---
title: Rendering content
description: Request Markdown output and retained bodies as query payloads.
section: rendering
order: 30
---

Metadata queries do not render content. Request the `_rendered` payload in the query that loads the article you want to display:

```ts
import { posts } from "content-query:collections/posts";

const post = await posts.findFirst({
  where: { id: "hello" },
  columns: { title: true },
  payloads: { _rendered: true, _body: true },
});
if (post) {
  const { html, headings } = post._payloads._rendered;
  const body = post._payloads._body;
}
```

With fluent queries, call `.withPayload("_rendered")` before the terminal. Payloads load after filtering and pagination, from the same revision as the rest of the result, and appear under `_payloads`. They can also be requested inside relationship scopes, but not in counts or adjacent entries.

## Markdown output

The `_rendered` payload contains HTML and headings with `depth`, `slug`, and `text`. HTML headings have matching unique IDs, and fenced code blocks are syntax highlighted. Your application owns heading links, templates, and presentation.

Authored links and image URLs pass through unchanged. The core renderer produces HTML with a fixed pipeline. Optional [MDX and React islands](/docs/mdx-and-islands) use the separate `@content-query/mdx` package and companion rendering APIs.

## Bodies and rendering policy

Markdown defaults to `retainBody: true` and `deferRender: false`. Production preparation compiles HTML eagerly, and the runtime loads each requested item's output separately. `deferRender: true` packages captured Markdown with the renderer for runtime compilation.

The `_body` payload is the retained text, or `undefined` when an entry has none; it never reads original source files. Entries without supplied HTML or a Markdown rendering path reject a `_rendered` request with `not-renderable`. A body provided by a custom loader does not automatically imply Markdown rendering.

Markdown sources, `glob()`, and custom loaders offer `_body` and `_rendered`. JSON, YAML, and TOML sources and `file()` hold data records only, so requesting either payload there is a type error. Custom loaders typed as `BodyLoader`, such as the MDX loader, offer `_body` only.

A query for a missing entry returns `undefined`, so handle page-not-found behavior where you check the result.

The repository's `content-query/examples/payloads/` example builds a static site that uses each kind of payload request, including payloads inside relationship scopes and HTML supplied by a custom loader.

See [how ContentQuery works](/docs/how-it-works) for preparation and production boundaries.
