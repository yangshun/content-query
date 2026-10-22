---
title: Rendering content
description: Load Markdown output and retained bodies explicitly.
section: rendering
order: 30
---

Metadata queries do not render content. Call `render()` for the article you want to display:

```ts
const { html, headings } = await content.render("posts", "hello");
const body = await content.readBody("posts", "hello");
```

## Markdown output

`render()` returns HTML and headings with `depth`, `slug`, and `text`. HTML headings have matching unique IDs, and fenced code blocks are syntax highlighted. Your application owns heading links, templates, and presentation.

Authored links and image URLs pass through unchanged. The core renderer produces HTML with a fixed pipeline. Optional [MDX and React islands](/docs/mdx-and-islands) use the separate `@content-query/mdx` package and companion rendering APIs.

## Bodies and rendering policy

Markdown defaults to `retainBody: true` and `deferRender: false`. Production preparation compiles HTML eagerly, and the runtime loads each requested item's output separately. `deferRender: true` packages captured Markdown with the renderer for runtime compilation.

`readBody()` returns retained text or `undefined`; it never reads original source files. Missing entries reject. A body provided by a custom loader does not automatically imply Markdown rendering.

See [how ContentQuery works](/docs/how-it-works) for preparation and production boundaries.
