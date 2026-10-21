---
title: Next.js
description: Build content and refresh Server Components with Turbopack or Webpack.
section: integrations
order: 41
---

Use `withContentQuery()` in an existing Next.js 16 App Router application. The adapter builds content before Next.js compiles and watches it during development.

## Install and define content

```sh
npm install content-query
```

Create `content-query.config.ts` and your content files at the application root. The [quick start](/docs/quick-start#define-a-collection) defines a `posts` collection you can use with the examples below.

## Wrap the Next.js configuration

In `next.config.mjs`, wrap your existing configuration:

```js
import { withContentQuery } from "content-query/next";

export default withContentQuery({
  trailingSlash: true,
});
```

The wrapper accepts a configuration object, promise, or [phase-aware configuration function](https://nextjs.org/docs/app/api-reference/config/next-config-js#configuration-as-a-function). Your Next.js settings remain application-owned.

Run your usual `next dev` or `next build` command. The adapter handles the content build automatically. Add the generated `.content-query/` directory to `.gitignore`.

## Add a runtime import alias

Add this mapping to your application's `package.json`:

```json
{
  "imports": {
    "#content-query": "./.content-query/server.js"
  }
}
```

The application-local alias resolves to the generated runtime from any directory depth. Generated declarations beside `server.js` provide inferred collection types. If you customize `outDir`, update the mapping to point to that directory's `server.js`.

## Query in Server Components

Import `content` through the alias from server code. For example, `app/page.tsx` can list the posts from the quick start:

```tsx
import "server-only";
import { content } from "#content-query";

export default async function PostsPage() {
  const posts = await content.select("id", "title").from("posts").all();

  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

Use Next.js's [`server-only` marker](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning) in modules that consume content. Keep collection configuration and the generated runtime in server code, and pass selected data to Client Components when needed. The same query API works in `generateMetadata()` and other server functions; [querying content](/docs/querying-content) covers filtering, relationships, and pagination.

## Development updates

The adapter waits for the initial content build, then watches content and collection configuration. Published changes update the generated modules, and Next.js refreshes their consumers through HMR. This works with both Turbopack and Webpack, including metadata changes and body-only edits.

Invalid metadata or configuration appears in Next.js's development overlay. Correcting the input publishes a valid runtime and allows the page to recover. The adapter reuses its watch session when Next.js evaluates the configuration again and closes it on shutdown.

Next.js's detached telemetry helper can also evaluate development configuration. The adapter skips content preparation in that helper, so it exits without leaving a watcher running after the application shuts down.

After the first successful content build, startup removes obsolete generated collection modules and development runtime entries left by previous runs. Invalid startup content delays cleanup until corrected. Revisions created during the current session remain available until the next successful startup or production build, so restarting the development server reclaims older files.

Your application owns route discovery and missing-entry handling. For collection-driven routes, query IDs in `generateStaticParams()` and handle missing entries in the page. The repository's `content-query/examples/next/` example exercises added, renamed, and removed content routes.

## Content options

Pass content settings as the second argument:

```js
import { withContentQuery } from "content-query/next";

export default withContentQuery(
  { trailingSlash: true },
  { config: "./content-query.config.ts", outDir: "./.content-query" },
);
```

`config` selects an exact configuration file; `outDir` changes the generated output directory. Both resolve relative to the application directory where the wrapper is created. By default, ContentQuery discovers the configuration and writes to `.content-query/`. The adapter uses the generated backend and manages watching. See the [configuration reference](/docs/reference/configuration) for standalone build options.

## Production and static exports

`next build` awaits a successful content build and closes the content session before compilation. Invalid content fails the build. Production uses the generated snapshot; rebuild to publish changed content.

For a static site, enable export mode outside development:

```js
import { withContentQuery } from "content-query/next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

export default withContentQuery((phase) => ({
  output: phase === PHASE_DEVELOPMENT_SERVER ? undefined : "export",
  trailingSlash: true,
}));
```

This keeps Next.js's static-export parameter checks from interfering with added or removed development routes. Provide `generateStaticParams()` for dynamic routes in the export, following Next.js's [static export guidance](https://nextjs.org/docs/app/guides/static-exports).

The exported site does not need source content, collection configuration, or the ContentQuery compiler at runtime.
