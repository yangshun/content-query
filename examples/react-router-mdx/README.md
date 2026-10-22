# React Router + MDX + React islands

A React Router framework-mode SSR application using [`@content-query/mdx`](../../packages/mdx/README.md). React Router owns routing, the HTML shell, navigation, history, and application hydration. The MDX package owns compilation, asset integration, widget scheduling, and cleanup. There is no custom server, client entry, or build script.

The same collection renders through `/islands/docs/:slug` and `/react/docs/:slug`. `/` links to both choices for every guide. `contentQueryMdx({ rendering: "both" })` emits independent widget entries and selectable ordinary document modules.

Source files use kebab-case names. Widgets and reusable components use named exports; route modules and configuration use the default exports required by React Router.

Minimal CSS uses compact typography: 15px body text, 24px page titles, and 18px section headings. The home page uses a divided guide list; document pages have a sticky sidebar that stacks above the article on small screens. A compact Islands/React toggle highlights the active mode beside its label and stays visible while scrolling in both layouts. On mobile, the guide list scrolls away to leave room for the article. The toggle uses ordinary route links; widget controls stay native, with small widget/callout styles that demonstrate CSS delivery.

## Run

From the repository root with Node.js 24.21.0 and Vite+:

```sh
vp install --frozen-lockfile
vp run build
vp run --filter @content-query/example-react-router-mdx dev
```

Open the printed local URL. Pass `--port` to the development command to choose a port.

```sh
vp run --filter @content-query/example-react-router-mdx build
vp run --filter @content-query/example-react-router-mdx preview
```

The production command uses React Router's application server (`react-router-serve`). `PORT` and `HOST` configure its listener. Deployment needs `build/client/`, `build/server/`, `package.json`, and installed runtime dependencies. It needs neither the application source nor `content/` or `content-query.config.ts`.

The MDX plugin uses an internal server graph to collect static-component styles before React Router builds its browser entries. It preserves emitted static assets and embeds the generated MDX manifest in the server bundle. Consumers use the normal framework build command.

The complete manifest stays in generated server inputs and the server bundle; no public manifest is emitted. Each guide links its own server-reachable CSS. Package widgets resolve their browser exports independently of server imports. Development validation errors retain the server and overlay, and content changes use the root route's `onContentUpdate` revalidation without an extra forced reload.

Generated declarations and MDX build intermediates share `.content-query/`, with companion files under `.content-query/mdx/`. The TypeScript include glob `.content-query/**/*.d.ts` covers both packages.

## Rendering modes

`app/routes/guide.tsx` imports its MDX APIs from `content-query:mdx:server` and chooses one rendering mode in its server loader:

- **Islands:** `renderMdx()` returns HTML and styles. `<MdxIslands>` displays that content and manages independent widget roots through navigation. No document module is downloaded.
- **React:** `loadMdxDocument()` returns a selected browser reference and prepares the server component. `<MdxDocument>` renders it inside the application's existing React tree, with Suspense and stylesheet loading handled by the package.

`renderMdx()` and `loadMdxDocument()` resolve their assets automatically. The optional `getMdxAssets()` helper from the same module supplies the document URL used by this example's byte measurements.

Context sharing is covered by the package's React integration tests; the example focuses on document rendering and widget interactions.

React Router hydrates its application shell in both modes. Prose-only island routes download no MDX document or widget entries, but still download the application's React runtime. The package's plain Vite integration tests separately verify the framework-independent path.

## Explore

- `counter.mdx` has one immediate counter, highlighted code, and a static callout. The widget uses one increment button and reserves space for the count so interactions keep the article in place.
- `loading.mdx` has one quiz, waiting for visibility in islands mode.
- `writing.mdx` contains prose and a static callout with its own stylesheet.

Each guide has at most one interactive widget. All four hydration strategies, browser-only imports, and shared widget modules are covered by the MDX package's tests.

React Router's links handle navigation and scroll restoration. Selecting the active rendering mode leaves the page and its measurements unchanged, without fetching page data again; modified clicks retain normal link behavior. The guide route delegates ordinary links inside authored MDX to the router, preserving modified clicks, external links, hashes, targets, and downloads. The package cancels island work before removing an article and ignores late imports; React Router handles obsolete loader requests and back/forward navigation.

## Compare measured loads

A compact row beneath the mode toggle reports browser measurements rather than predicted bundle sizes:

- **JS:** uncompressed external JavaScript response bytes, including cache hits.
- **MDX entry:** response bytes for this document's selected module, excluding imported dependencies. Receiving its URL does not download it in islands mode.
- **Transferred:** browser-reported same-origin transfers, including HTML, route data, JavaScript, CSS, images, and estimated response headers.

The row labels each measurement as **Full page load** or **Additional navigation load**. Full page loads include HTML and the React Router shell. Client navigation starts a new measurement window before link/history loading and counts only additional requests; the shell and modules already imported in the page are reused. Refreshing starts a full-page measurement again, but can still use the browser's HTTP cache. Amounts depend on navigation history and caching. Compare modes using full page loads in separate fresh browser sessions, rather than comparing a refresh with a client navigation.

Expand the row for resource/cache counts and a reload button. The numbers update when deferred widgets load. Hash changes retain the current measurement. These counters are optional example instrumentation, not required application setup.

For islands, the expanded details also show the exact UTF-8 byte count of rendered article HTML. Standard React Router SSR sends that HTML as markup and serializes it again in hydration data; escaping and compression affect the final transfer size. The full-page transfer total includes both copies, while client navigation receives route data without another HTML document. This example retains normal React Router hydration rather than introducing a separate HTML transport. Its byte comparison includes that framework cost.

The [Resource Timing API](https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-transfersize) reports zero transfer for local cache hits and estimates header overhead. Compare production builds in fresh browser sessions or with browser caching disabled for cold-load numbers. Development serves unbundled modules and is labeled separately. No speed or bundle-size advantage is assumed; the displayed results include this example's instrumentation.

## Verify

```sh
vp run --filter @content-query/example-react-router-mdx browsers:install
vp test run examples/react-router-mdx
```

Tests build an isolated copy with `NODE_ENV=production`, delete application source, content, collection configuration, and generated intermediates, start the production server, and exercise both modes in Chromium. They verify interactions, scheduling, styles, assets, mobile layout, navigation/history, refresh-versus-navigation measurements, obsolete requests, and JavaScript request boundaries. A separate smoke check runs the documented development command and switches between both modes. CI includes these tests. No large-corpus performance claim is included.

Temporary fixtures share installed packages and forward CLI calls to their physical launchers so pnpm's relative paths work outside the workspace.
