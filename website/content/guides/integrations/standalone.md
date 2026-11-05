---
title: Standalone usage
description: Build content with the CLI or build API and query it without a framework integration.
section: integrations
order: 43
---

Without the Vite or Next.js integration, run the CLI during your application's build, then import each collection's generated entry from server code. This walkthrough renders the post from the [quick start](/docs/quick-start) with Node.js alone. Follow its [install](/docs/quick-start#install), [collection](/docs/quick-start#define-a-collection), and [post](/docs/quick-start#add-a-post) steps first, and skip the framework integration.

## Build the content

```sh
npx content-query build
```

This writes one runtime entry per collection, with inferred types, to `.content-query/`. The `posts` collection's entry is `.content-query/collections/posts/server.js`. Add that directory to `.gitignore`.

## Query and render

Create `render.mjs` in the project root:

```js
import { writeFile } from "node:fs/promises";
import { posts } from "./.content-query/collections/posts/server.js";

const post = await posts.select("id", "title").withPayload("_rendered").first();
if (!post) {
  throw new Error("Add a post before rendering.");
}

const { html } = post._payloads._rendered;
await writeFile(
  "post.html",
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>ContentQuery</title><main>${html}</main></html>`,
);
```

Run `node render.mjs` and open `post.html`. In a server application, the same query belongs in your request handler.

## Build API

Applications can also build content directly:

```ts
import { buildContent } from "content-query/build";
import type { collections } from "./content-query.config";

const session = await buildContent<typeof collections>({
  backend: "in-memory",
});

try {
  const entries = await session.collections.posts.select("id", "title").all();
} finally {
  await session.dispose();
}
```

`session.collections` holds one handle per collection, keyed by collection name, with the same query API as the generated entries. Follow relationships with [`using()`](/docs/relationships#supply-related-collections), such as `session.collections.posts.using(session.collections.authors)`. The in-memory backend writes no runtime content artifacts. Use the generated backend when the deployment should consume prepared ESM files.

## Watching and deployment

Content builds are one-shot by default. Use `content-query build --watch`, or set `watch: true` for a managed build session, and dispose it when the host shuts down. Other bundlers must enforce their own server-only import boundary.

A generated watch session removes obsolete collection modules from previous runs after its first successful content build. Invalid startup content delays cleanup until corrected. Later updates retain revisions for that session; starting a new session after previous consumers stop reclaims older files. One-shot builds also remove obsolete collection modules. Application-owned files in the output directory are preserved.

See the [CLI reference](/docs/reference/cli) for build and watch commands.
