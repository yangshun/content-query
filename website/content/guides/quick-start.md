---
title: Quick start
description: Add ContentQuery to a full-stack application and render a post from server code.
section: getting-started
order: 2
---

This walkthrough adds ContentQuery to a full-stack framework whose server code loads page data, such as React Router, SvelteKit, TanStack Start, or Next.js. To build content without a framework integration, see [standalone usage](/docs/integrations/standalone).

## Install

Requires Node.js 22.12 or later.

```sh
npm install content-query
```

## Add the integration

Vite-based frameworks add the ContentQuery plugin next to their own plugins in `vite.config.ts`:

```ts
import { contentQuery } from "content-query/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [contentQuery()],
});
```

Include `.content-query/**/*.d.ts` in your `tsconfig.json` for the generated collection types, and add `.content-query/` to `.gitignore`.

For Next.js, wrap your configuration with `withContentQuery()` and add the `#content-query/*` import alias from the [Next.js guide](/docs/integrations/next). Then import `#content-query/posts` wherever this walkthrough imports `content-query:collections/posts`.

## Define a collection

Create `content-query.config.ts` in your project root:

```ts
import { defineCollection } from "content-query";
import { schema } from "content-query/schema";

export const collections = {
  posts: defineCollection({
    source: "./content/posts",
    schema: schema.object({
      title: schema.string(),
      draft: schema.boolean().default(false),
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

## Query from server code

Collections load only on the server. Create a server-only module, such as `app/posts.server.ts`, for the queries your routes need:

```ts
import { eq } from "content-query/query";
import { posts } from "content-query:collections/posts";

export async function listPosts() {
  return posts
    .select("id", "title")
    .where((fields) => eq(fields.draft, false))
    .orderBy("title")
    .all();
}

export async function getPost(id: string) {
  return posts
    .select("id", "title")
    .where((fields) => eq(fields.id, id))
    .withPayload("_rendered")
    .first();
}
```

Queries return only the fields they select, so `listPosts()` returns `[{ id: "hello", title: "Hello ContentQuery" }]`. Only `getPost()` loads a post's rendered HTML. Call these functions from your framework's server data loading, such as route loaders, server functions, or Server Components. The [framework guides](/docs/integrations/frameworks) list where each framework runs them. Keep the collections out of client modules; the Vite plugin rejects client imports of the server runtime.

## Render a post

Call `getPost(params.id)` in the loader for a route such as `/posts/:id`, and respond with a 404 when it returns `undefined`. The post's HTML is in `post._payloads._rendered.html`:

```html
<h2 id="my-first-post">My first post</h2>
<p>Content starts here.</p>
```

Insert it with your template's raw HTML output, such as React's `dangerouslySetInnerHTML` or Svelte's `{@html}`. The payload also lists the post's headings for a table of contents.

## Develop and deploy

Start your framework's development server as usual. The integration prepares content before serving it, then watches your content and `content-query.config.ts`. To show edits without a reload, connect your framework's data refresh as described in [development updates](/docs/integrations/vite#development-updates). Next.js refreshes Server Components through HMR.

Production builds prepare content once, so deployments do not need the source files or collection configuration.

Continue with [collections and schemas](/docs/collections-and-schemas) or [querying content](/docs/querying-content).
