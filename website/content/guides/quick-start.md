---
title: Quick start
description: Define a collection, add a post, and render it with the standalone runtime.
section: getting-started
order: 2
---

This walkthrough uses the CLI so you can try ContentQuery without choosing a framework. For an existing Vite application, see the [Vite integration](/docs/integrations/vite).

## Install

```sh
npm install content-query zod
```

## Define a collection

Create `content-query.config.ts` in your project root:

```ts
import { defineCollection } from "content-query";
import { z } from "zod";

export const collections = {
  posts: defineCollection({
    source: "./content/posts",
    schema: z.object({
      title: z.string(),
      draft: z.boolean().default(false),
    }),
  }),
};
```

## Add a post

Create `content/posts/hello.md`. The filename gives this entry the ID `hello`.

```md
---
title: Hello ContentQuery
---

## My first post

Content starts here.
```

## Build the content

```sh
npx content-query build
```

This writes the runtime and inferred types to `.content-query/`. Add that directory to `.gitignore`.

## Query and render

Create `render.mjs` in the project root:

```js
import { writeFile } from "node:fs/promises";
import { content } from "./.content-query/server.js";

const post = await content.query("posts").select("id", "title").first();
if (!post) {
  throw new Error("Add a post before rendering.");
}

const { html } = await content.render("posts", post.id);
await writeFile(
  "post.html",
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>ContentQuery</title><main>${html}</main></html>`,
);
```

Run `node render.mjs` and open `post.html`. In a framework application, the same query and render calls belong in your server loader or server component.

Continue with [collections and schemas](/docs/collections-and-schemas) or [querying content](/docs/querying-content).
