# ContentQuery + Angular

Server metadata queries use `content.select(...fields).from(collection)`. The relational API is available as `content.query.<collection>.findMany({ columns, with, where })`; bodies and rendered HTML are loaded separately.

Collection schemas use `schema` from `content-query/schema`, which supplies Zod-backed builders without a separate Zod dependency.

A small documentation site using Angular Router, native `@angular/ssr`, and ContentQuery. Every guide has a dedicated `/docs/<id>/` URL, including nested IDs. The Node server renders the initial HTML; Angular hydrates it and handles subsequent navigation.

## Run locally

From the repository root, use Node.js 24.21.0 and Vite+:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @voidpress/content-query-angular dev
```

The development command builds content once, then runs `content-query build --watch` alongside `ng serve`. Content publications update the generated server entry, which Angular CLI watches as a server dependency. Angular rebuilds and reloads the page after metadata, body, added/deleted guide, and configuration changes. Validation failures appear in the terminal; the last valid generated content remains available until corrected. Stopping development stops both processes.

Angular CLI manages its own build and development server. This example uses the standalone ContentQuery CLI and physical `.content-query/server.js` entry. It does not require a framework adapter or a Vite plugin.

## Build and serve

```sh
vp run --filter @voidpress/content-query-angular build
vp run --filter @voidpress/content-query-angular start
```

The build runs `content-query build` before `ng build`. Deploy `dist/angular/` and the production dependencies, then run `node dist/angular/server/server.mjs`; `PORT` defaults to 4000. Set Angular's `NG_ALLOWED_HOSTS` environment variable to your deployment hostname; localhost is configured for local use. This example requires a Node server. Its compiled server bundles the prepared content, so deployment does not need `content/`, `content-query.config.ts`, or `.content-query/`.

## Data and routing

- `src/app/app.routes.ts` defines Angular routes and resolvers. The docs parent owns the sidebar, and the child resolver loads only the selected article.
- `src/server/content.ts` keeps ContentQuery queries on the server. Home and sidebar queries select metadata only; article queries render Markdown and select `_adjacent` neighbors.
- `src/server.ts` uses Angular's standard Express request handler. Small API routes expose the selected results for client navigation. `GuidesApi` uses Angular `HttpClient`, whose native transfer cache reuses SSR responses during hydration. Its result types are inferred through erased server type imports.
- Missing guides return 404 from both the API and SSR. Angular owns page titles, descriptions, active sidebar links, and scroll restoration. Internal Markdown links use Angular Router and preserve the docs layout.

The Markdown comes from trusted repository files. The article component explicitly trusts ContentQuery's rendered HTML so syntax highlighting retains its inline styles.

Styles and the browser navigation helper are local files, hardlinked to the common copies in `../shared` in this workspace. Git stores ordinary file contents, so the example can be copied independently. Generated content and Angular build caches are ignored.

## Verify

```sh
vp test run examples/angular/tests
```

Tests build and run the real SSR application after removing source content and generated input files, verify nested guide routes and API projections, check 404 responses and browser bundle boundaries, and exercise the real development watcher.

Fixture commands use `vp env exec` with the workspace's `.node-version`, including nested build scripts and the production server. Temporary fixtures therefore use the required Node version even when the shell's `node` points to an older installation.
