# ContentQuery website

The [computed fields guide](./content/guides/computed-fields.md) covers collection names and optional, typed loader source metadata, with file and CMS examples that make those values queryable. It distinguishes the ContentQuery metadata extension from Astro's standard entry fields and explains source-only updates and digest behavior.

Standalone examples and documentation use `content-query build` (or `content-query build --watch`) and `buildContent()` from `content-query/build`. The CLI reference documents CAC's help/version output, short option aliases, and equals-form values. Framework guides also cover the native Angular SSR example, its server API boundaries, and CLI development watching.

The [Next.js guide](./content/guides/integrations/next.md) documents `withContentQuery()` from `content-query/next`, including configuration, the application-local `#content-query` import alias in `package.json`, inferred Server Component types, content options, development updates and error recovery with Turbopack or Webpack, and production/static exports. The introduction, quick start, framework guide, and configuration reference link to that setup. The homepage's Next.js workflow shows the configuration and alias mapping beside its server query.

The Next.js and standalone guides describe cleanup of previous-run generated artifacts after the first successful startup publication and retention of revisions for the rest of a watch session.

A Void + React website based on [`../examples/void`](../examples/void), styled to match the [VoidPress docs app](../../apps/docs). A compact header leads to a dedicated homepage at `/` and sidebar documentation starting at `/docs/introduction`. The dark background, lime accents, article typography, and compact previous/next text links are shared across the site. On small screens, the docs sidebar becomes a collapsible menu. Styles are local so the website can move with ContentQuery.

The header has no bottom divider and leaves 2.5rem before page content, reduced to 2rem on small screens. Hero action buttons use compact padding and text sizes.

The sidebar follows the reader's workflow: Getting started, Defining content, Querying, Rendering, Integrations, and Reference. These pages introduce ContentQuery's current APIs with concise examples. Query filtering, selection, pagination, related entries, and adjacency share one guide; Markdown rendering and body policies share another. Expand those into separate pages as the content grows. Development content updates remain enabled.

All guides are prerendered at `/docs/<guide-id>`. The sidebar and previous/next links follow their `order`. Adding or reordering guides does not change the homepage.

## Homepage examples

The homepage hero pairs its introduction with an animated content-flow diagram on the right, stacking them on smaller screens. `src/content-flow.tsx` illustrates files becoming posts and authors, with animated associations connecting posts to their authors before content reaches the application. A subtle dashed frame fits the node rows with equal padding on every side and space before the labels below it. Post and author text use neutral colors. It includes a pause control and a static reduced-motion presentation.

Nine examples start with the complete source-to-data flow, followed by query syntax, typed queries, relationships, flexible sources, typed collections, computed fields, Markdown rendering, and Vite, Next.js, or standalone workflows. Each heading and description sits above a full-width, bordered example. Homepage sections are separated by spacing without horizontal divider lines. Each component owns its layout and content, sharing only small display and control primitives. There is no shared layout component imposing the same stages on every feature.

Each example has its own component file in `src/examples/`, imported directly by the homepage. `src/examples/shared.tsx` contains shared code displays, controls, sample-post tables, and validation feedback. Example-specific state and helper components stay with their example.

Homepage source file labels and validation diagnostics include the `content/posts/` directory. Workflow import statements keep the module path on the same line as `from`.

The opening example follows `content/posts/hello-world.md` through four columns: source data, schema, query, and data. It omits column headers, with file paths and syntax distinguishing each stage. Its collection configuration validates the post's title and draft status, and the query selects those fields into the displayed JSON. The columns become two on tablet-sized screens and stack on narrow screens. An integration test prepares the displayed source with the displayed schema and runs the query against the generated runtime to verify the result.

The query syntax comparison starts with sample posts on the left, followed by operation controls, both query styles, and shared JSON results.

The relationship author selector uses first names (`Ada` and `Grace`) to keep both choices on one line. Source records and results retain full author names. The data column has two separate stacked sections headed `posts` and `authors`, with three sample posts, both authors, compact record rows, and ID fields. Queries use those same three posts. Matching IDs are highlighted when the query includes the author. The visible relationship definition explains the connection without an arrow.

The flexible sources example uses three columns: a vertical format selector with logos on the left, the authored file and source configuration stacked in the middle, and prepared JSON on the right. Format logos are bundled locally from [Simple Icons](https://github.com/simple-icons/simple-icons) in `src/examples/source-format-logo.tsx` and follow the selected button color. The result has no header row. On narrow screens, the columns stack.

All homepage code blocks and JSON results use Shiki with the same GitHub Dark theme as the docs. `src/highlighted-code.tsx` loads only the TypeScript, Markdown, JSON, YAML, TOML, HTML, and shell grammars needed by the examples. Highlighting is present during server rendering and updates with the interactive controls. Operation and error line highlights stay visible, and code remains escaped text. Tests cover every supported language, source preservation, and error highlighting.

The syntax comparison keeps controls, sample posts, both query styles, and a shared JSON result visible together without column headers; Fluent and Object identify the two code samples. The typed query example shows sample data, checkboxes inside the query pane, and JSON results without an inferred-type display or result header. Relationships use four columns for the source records, visible relationship definition, query, and JSON result. Three sample posts and both authors stay visible in the first column; the author selector and related-author checkbox sit with the query. Selecting an author updates the query and results, and including the relationship highlights matching source records. Source formats show the authored file beside its prepared entry. Typed collections pair the content file and schema with validation success or field-specific diagnostics. Computed fields show reading time beside its resolver. Markdown uses source and rendered-preview panes, with HTML and headings available. The workflow demo offers a Vite development timeline and file-to-application animation, a Next.js configuration and server-query example, and a standalone build with runtime imports. Code results scroll when needed; format selectors, result-count summaries, and filler notes stay removed. Layouts adapt independently to smaller screens, and animations respect reduced-motion styles.

`src/feature-example-data.ts` owns the sample data and displayed snippets. Homepage query snippets omit the `eq` import to focus on the queries. Query controls run against the small local dataset; integration tests execute all 36 control combinations with both query syntaxes, checking 72 snippets against the actual generated ContentQuery runtime. They also check selected result types against generated declarations and verify misspelled fields are rejected. The Markdown HTML and headings come from ContentQuery's renderer during preparation, using the build-only collection in `src/feature-example-collection.ts`. Homepage styles live in `src/homepage.css`.

## Development

Public guides and homepage examples use standard Vite configuration and npm/npx commands.

From the repository root, using Node.js 24.21.0 and Vite+:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @content-query/website dev
```

`void` and `@void/react` use `catalog:` references to the matching `1.1.12` pins in the root `pnpm-workspace.yaml`.

## Build and verify

```sh
vp run --filter @content-query/website build
vp run --filter @content-query/website preview
vp check
vp test run
```

Static pages are emitted to `dist/client/`. The Cloudflare Worker name is `content-query`, which is also the site's `workers.dev` subdomain prefix; this app is not wired into the existing deployment scripts.

## Pages

Edit or add Markdown files in `content/guides/` with validated frontmatter:

```yaml
title: Your page title
description: A short explanation of what the reader will learn.
section: defining-content
order: 14
```

`src/docs-navigation.ts` defines the six sidebar section IDs and labels. Use `getting-started`, `defining-content`, `querying`, `rendering`, `integrations`, or `reference`. Use order ranges 1–9, 10–19, 20–29, 30–39, 40–49, and 50–59 for those sections. Keep orders distinct and aligned with section order so sidebar and previous/next navigation agree.

Introduction renders at `/docs/introduction`. Nested files work too: `reference/cli.md` becomes `/docs/reference/cli`. Rebuild to include new static routes.

`tests/guides.integration.test.ts` exercises the real ContentQuery integration, homepage examples and SSR output, section metadata, guide loaders, internal links, executable snippets, and prerender paths. It runs every published Next.js configuration against the quick-start collection, executes the homepage's aliased server query, and type-checks the guide's Server Component against the generated declarations.
