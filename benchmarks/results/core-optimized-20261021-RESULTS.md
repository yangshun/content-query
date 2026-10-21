# ContentQuery full-site benchmarks

Run: 2026-10-20T16:02:58.301Z. Completed: 2026-10-20T16:14:44.892Z.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across benchmark apps (60000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Selected stacks: Astro collections, Void + ContentQuery, TanStack Start + ContentQuery.

Validation: 36/36 recorded samples passed. 18/18 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./single-page-RESULTS.md) and [raw samples](./single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                         |          Content usable |         Production build |
| ----------------------------- | ----------------------: | -----------------------: |
| Void + ContentQuery           | 3.99 (3.98–4.11; n=3/3) | 9.69 (7.71–10.00; n=3/3) |
| Astro collections             | 3.50 (3.29–3.56; n=3/3) |  4.22 (3.99–4.30; n=3/3) |
| TanStack Start + ContentQuery | 3.12 (3.09–5.56; n=3/3) |  8.31 (7.65–8.33; n=3/3) |

### Warm

| Stack                         |          Content usable |         Production build |
| ----------------------------- | ----------------------: | -----------------------: |
| Void + ContentQuery           | 3.50 (3.16–4.73; n=3/3) | 9.67 (8.72–10.22; n=3/3) |
| Astro collections             | 2.95 (2.85–3.50; n=3/3) |  5.57 (5.18–5.74; n=3/3) |
| TanStack Start + ContentQuery | 2.68 (2.65–3.09; n=3/3) |  6.78 (6.70–7.71; n=3/3) |

## Method

- Three cold/warm pairs by default; 3 requested stacks in this run. Only one framework and measurement type (startup or build) runs at a time, in a seeded random app order per repetition. Each server, build, and validation preview is shut down before the next sample starts. No Vite task-result cache is used.
- Before every sample, the runner waits for host CPU to become idle, so background work triggered by earlier samples, such as file indexing of tens of thousands of emitted pages, does not overlap the next measurement. Host state before each sample is recorded in the raw results.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.
- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, Void uses getPrerenderPaths(), Next.js uses generateStaticParams() with output: export, and TanStack Start uses its native prerender link crawler. Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.
- Results compare complete application stacks under this workspace's Vite+ configuration. Next.js uses its native Turbopack bundler; Vite-based stacks inherit the workspace dependency overrides. Every command runs through the app's own Vite+ CLI, so each stack uses the toolchain version it declares. All apps produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ. ContentQuery's Next.js adapter uses generated artifacts; its Vite adapter defaults to in-memory storage.

## Order and host load

App order was shuffled independently for each repetition with seed `20261021`:

1. astro, void, tanstack-start
2. void, astro, tanstack-start
3. void, astro, tanstack-start

Before every sample, the runner waited until host CPU was at least 80% idle, averaged over 3 consecutive 1-second windows, for up to 180 seconds. 36/36 samples started on a settled host. Median idle before a sample: 82% (80%–88%); median wait: 5.5 s (maximum 77.1 s).

Spotlight did not index new files under the applications directory during this run.

## Environment

- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `2bbf6b5a9cea6e4424629dc56861e66e43a74bf2`; uncommitted changes: true.
- Lockfile SHA-256: `2b4fb07508b48bb20952a0a80e5e95794a894d6eac81b10a52eaea0e8ecf6f99`.
- Built ContentQuery JavaScript SHA-256: `4555c466b87b713367e6b646c4d9cc0540ceb24d7fc69c422c62d2c977f9ee52`; unchanged during measurement: true.

```text
VITE+ - The Unified Toolchain for the Web

vp v0.0.0

Local vite-plus:
  vite-plus  v0.1.16

Tools:
  vite             v8.0.5
  rolldown         v1.0.0-rc.13
  vitest           v4.1.2
  oxfmt            v0.43.0
  oxlint           v1.58.0
  oxlint-tsgolint  v0.20.0
  tsdown           v0.21.7
```

## Versions and output

| Stack                         | Resolved packages                                                                                                                                                        | Normal output                                       | Command               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------- |
| Astro collections             | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                        | Static HTML                                         | `vp exec astro build` |
| Void + ContentQuery           | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                | Static HTML + bundled content                       | `vp build`            |
| TanStack Start + ContentQuery | @tanstack/react-start@1.169.3, @tanstack/react-router@1.170.45, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@1.3.0, @voidzero-dev/vite-plus-core@1.3.0 | Prerendered HTML + React hydration (TanStack Start) | `vp build`            |

## Failures

None recorded.

Raw samples and environment: [core-optimized-20261021.json](./core-optimized-20261021.json). Reproduction: [README](../README.md).
