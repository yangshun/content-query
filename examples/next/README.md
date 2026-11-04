# ContentQuery x Next.js

Server metadata queries use `content.select(...fields).from(collection)`. The relational API is available as `content.query.<collection>.findMany({ columns, with, where })`; bodies and rendered HTML are requested as payloads, with `payloads: { _rendered: true }` or `.withPayload("_rendered")`.

Collection schemas use `schema` from `content-query/schema`, which supplies Zod-backed builders without a separate Zod dependency.

A small Next.js App Router documentation site in `examples/next`, backed by ContentQuery. It uses the same sample project-notebook guides as the Void example, with a homepage index, Markdown articles, ordered navigation, page metadata, and missing-guide handling.

## Development

Use the repository's Node.js 24.21.0 runtime and Vite+ CLI, pinned through the shared workspace catalog. From the repository root:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @content-query/example-next dev
```

Open [localhost:3000](http://localhost:3000). `vp run` executes the Next.js script; `vp dev` would start Vite instead.

`withContentQuery()` builds content before the development server compiles, then watches Markdown, collection schemas, and loader configuration. Published changes update the generated modules and Next.js refreshes their consumers. This includes body-only changes and added, renamed, or removed guides. Content errors appear in Next's development overlay and recover after a valid edit.

After the first successful content build, startup removes obsolete collection modules and `next-dev-*.js` entries from previous runs while preserving the new snapshot. Invalid startup content delays cleanup until corrected. Later edits retain revisions for the rest of that session; restarting the server reclaims previous-run files. Repeated Next.js configuration evaluation reuses the session without cleaning again.

The adapter skips content preparation when Next's detached telemetry helper reads the development configuration. This lets the helper exit without leaving a content watcher behind after the application shuts down.

## Production

```sh
vp run --filter content-query build
vp run --filter @content-query/example-next build
```

`next.config.mjs` wraps the static-export configuration with `withContentQuery()` from `content-query/next`. The adapter owns a persistent development session and cleans it up on shutdown. Production awaits a one-shot content build and disposes its session before compilation; invalid content fails the build. Content generation uses the same compiler as the standalone API and CLI.

The phase-aware configuration enables `output: "export"` outside development. Development uses normal Next.js route handling so added and removed content routes do not encounter static-export parameter checks.

Guide URLs use Next.js's default convention without trailing slashes, such as `/docs/getting-started`. Next.js exports `/` to `out/index.html`, guide pages to `out/docs/<guide-id>.html`, and the missing-guide page to `out/404.html`. Deploy `out/` to a static host configured to resolve extensionless URLs to their `.html` files. The exported site needs no Node.js server, Markdown source files, collection configuration, or ContentQuery compiler. `next start` does not serve static exports.

## Content and routing

- `content-query.config.ts` defines a Markdown collection with the string `source` shorthand with bundled metadata schema builders.
- `.content-query/` holds the generated ESM runtime and its inferred TypeScript declarations, including `CollectionKey`, `CollectionData`, and `Collections`. It is ignored by Git and regenerated automatically before compilation.
- `package.json` maps `#content-query` to `./.content-query/server.js` through its `imports` field. Server Components use `import { content } from "#content-query"` at any directory depth, with inferred types from the adjacent generated declarations.
- Queries are inline in `app/page.tsx`, `app/docs/layout.tsx`, and `app/docs/[...slug]/page.tsx`. Next.js's `server-only` marker prevents client components from importing these server modules.
- The homepage queries selected metadata without rendering any guide bodies. `generateMetadata()` also selects metadata only.
- `app/contents/page.tsx` lists every guide with links to its sections. Its `findMany()` requests the `_rendered` payload for every guide and reads only the headings; this is the one listing that opts into payloads.
- `generateStaticParams()` maps collection IDs to catch-all route segments. Nested files such as `content/guides/reference/shortcuts.md` become `/docs/reference/shortcuts`.
- `app/docs/layout.tsx` loads only sidebar IDs/titles and persists across guide navigation. Its small client `sidebar.tsx` updates the active link from `usePathname`; the article page does not load or pass navigation entries.
- The guide page awaits its route parameters and selects previous/next links with an independent `_adjacent` sibling scope. The same query requests both built-in payloads: `_rendered` for the article and `_body` for a collapsible Markdown source view. Detail queries use the object API; the index also demonstrates fluent queries. `dynamicParams = false` rejects paths outside the generated collection.
- Source Markdown is trusted repository content. Server Components load and render it; the client presentation component handles internal link clicks. Application code owns routing and presentation.

To add a guide, create a Markdown file under `content/guides/` with `title`, `description`, and numeric `order` frontmatter. Development discovers its route automatically; rebuild the static export to publish it in production.

This follows Next.js's [async configuration](https://next.org/docs/app/api-reference/config/next-config-js), [static export](https://next.org/docs/app/guides/static-exports), and [generateStaticParams](https://next.org/docs/app/api-reference/functions/generate-static-params) APIs.

## Verification

```sh
vp run check
vp test run
vp run --filter @content-query/example-next build
```

The integration suite builds a real Next.js consumer through `next.config.mjs`, then checks its exported index, metadata, Markdown rendering, Markdown source, contents page, adjacent guides, nested routes, and 404 page after removing source content and configuration. It also checks that invalid content blocks compilation. Development tests run real Turbopack and Webpack servers and exercise metadata/body edits, route additions/renames/deletions, configuration updates, and invalid-content recovery.

Both suites run against every Next.js release in `content-query`'s `next` peer range that the example installs: the current `next` dependency, plus Next.js 15.5 and 15.0 through the `next-15.5` and `next-15.0` aliases. Production builds use Webpack and Turbopack, except on Next.js 15.0, which has no Turbopack production builds; development servers use both bundlers on every release. `tests/next-releases.ts` copies the example into `.content-query/` at the repository root and links each dependency's real directory into the copy, with `next` pointing at the selected release. Turbopack only resolves packages inside its root, and Turbopack 15 does not follow a link to another link. For Next.js 15, the copy also declares plain stylesheet imports, as Next.js 16's global types do, because Next.js 15 type checks builds and the workspace's TypeScript 6 rejects undeclared side-effect imports by default. When the peer range changes, update the aliases and `nextReleases`.

The root layout imports its local stylesheet, hardlinked to the common [`../shared/styles.css`](../shared/styles.css) in this workspace, giving all five examples the same header, footer, home index, sidebar, article typography, and responsive layout. Queries stay inline in Server Components and route metadata functions. `app/docs/content.tsx` is a small client presentation boundary that routes internal Markdown links through Next.js while keeping the docs layout mounted.

The example is self-contained: its stylesheet and browser navigation helper (where needed) are local files. Hardlinks keep the common copies synchronized in this workspace. Git stores ordinary file contents, so copying or checking out an example does not require sibling shared files.

TypeScript tooling uses the workspace's shared compatibility catalog for framework APIs. Native TypeScript `7.1.0-beta` is available at the repository root; see the [compiler setup](../../CONTRIBUTING.md#setup-and-checks).
