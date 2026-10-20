# ContentQuery full-site benchmarks

Run: 2026-10-20T10:38:14.019Z. Completed: 2026-10-20T11:22:01.490Z.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across benchmark apps (60000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Validation: 72/72 recorded samples passed. 36/36 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./results/single-page-RESULTS.md) and [raw samples](./results/single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                              |             Content usable |           Production build |
| ---------------------------------- | -------------------------: | -------------------------: |
| Void + ContentQuery                |    5.27 (5.10–5.47; n=3/3) |  10.09 (9.05–11.26; n=3/3) |
| Astro collections                  |    3.53 (3.23–5.46; n=3/3) |    5.98 (5.82–6.53; n=3/3) |
| TanStack Start + ContentQuery      |    3.96 (3.79–6.66; n=3/3) |    7.69 (6.04–8.58; n=3/3) |
| Vite + React + Content Collections |   9.54 (8.40–11.16; n=3/3) |    7.89 (7.25–9.97; n=3/3) |
| Nuxt Content                       | 17.27 (15.62–18.57; n=3/3) | 62.21 (60.18–65.46; n=3/3) |
| Next.js + ContentQuery             | 20.98 (18.61–23.10; n=3/3) | 41.66 (38.69–46.19; n=3/3) |

### Warm

| Stack                              |             Content usable |           Production build |
| ---------------------------------- | -------------------------: | -------------------------: |
| Void + ContentQuery                |    4.47 (3.85–4.50; n=3/3) |  12.20 (9.81–12.78; n=3/3) |
| Astro collections                  |    5.87 (3.63–6.20; n=3/3) |    7.04 (6.59–7.13; n=3/3) |
| TanStack Start + ContentQuery      |    3.52 (3.02–4.39; n=3/3) |    7.78 (7.26–8.03; n=3/3) |
| Vite + React + Content Collections |    8.92 (6.63–9.05; n=3/3) |    7.02 (6.99–7.86; n=3/3) |
| Nuxt Content                       |    7.44 (5.85–7.81; n=3/3) | 64.34 (55.45–79.43; n=3/3) |
| Next.js + ContentQuery             | 15.35 (14.36–17.21; n=3/3) | 43.14 (38.14–46.36; n=3/3) |

## Method

- Three cold/warm pairs by default, all six stacks in one run. Only one framework and measurement type (startup or build) runs at a time, in a seeded random app order per repetition. Each server, build, and validation preview is shut down before the next sample starts. No Vite task-result cache is used.
- Before every sample, the runner waits for host CPU to become idle, so background work triggered by earlier samples, such as file indexing of tens of thousands of emitted pages, does not overlap the next measurement. Host state before each sample is recorded in the raw results.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.
- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, Void uses getPrerenderPaths(), Next.js uses generateStaticParams() with output: export, and TanStack Start uses its native prerender link crawler. Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.
- Results compare complete application stacks under this workspace's Vite+ configuration. Next.js uses its native Turbopack bundler; Vite-based stacks inherit the workspace dependency overrides. Every command runs through the app's own Vite+ CLI, so each stack uses the toolchain version it declares. All apps produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ. ContentQuery's Next.js adapter uses generated artifacts; its Vite adapter defaults to in-memory storage.

## Order and host load

App order was shuffled independently for each repetition with seed `20261020`:

1. nuxt, astro, next, void, tanstack-start, vite-react
2. nuxt, tanstack-start, astro, next, vite-react, void
3. vite-react, void, astro, nuxt, tanstack-start, next

Before every sample, the runner waited until host CPU was at least 80% idle, averaged over 3 consecutive 1-second windows, for up to 180 seconds. 72/72 samples started on a settled host. Median idle before a sample: 81% (80%–88%); median wait: 8.0 s (maximum 177.2 s).

Spotlight did not index new files under the applications directory during this run.

## Environment

- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `10243a4952e92ac8e9cde1abb5cf01596c76dcb8`; uncommitted changes: true.
- Lockfile SHA-256: `6d1776a6d25e47714e6bc508aefb855354214af33be9465c37d347942584a674`.
- Built ContentQuery JavaScript SHA-256: `fc104e63574fb1c3d01c6ce7b46ab4381e1226bc922a7de9943189e0776f9926`; unchanged during measurement: true.

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

| Stack                              | Resolved packages                                                                                                                                                                             | Normal output                                       | Command                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------- |
| Astro collections                  | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                                             | Static HTML                                         | `vp exec astro build`     |
| Vite + React + Content Collections | react@19.2.5, react-dom@19.2.5, @content-collections/core@0.15.3, @content-collections/vite@0.3.1, @content-collections/markdown@0.1.4, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16 | Prerendered HTML + React hydration (Vite SSR/SSG)   | `vp run --no-cache build` |
| Nuxt Content                       | nuxt@4.6.2, vue@3.5.44, @nuxt/content@3.16.2, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                            | Prerendered HTML + Nuxt payloads (nuxt generate)    | `vp exec nuxt generate`   |
| Void + ContentQuery                | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                                      | Static HTML + bundled content                       | `vp build`                |
| Next.js + ContentQuery             | next@16.4.2, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@0.1.16                                                                                                             | Static HTML + RSC payloads (Next.js export)         | `vp exec next build`      |
| TanStack Start + ContentQuery      | @tanstack/react-start@1.169.3, @tanstack/react-router@1.170.45, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@1.3.0, @voidzero-dev/vite-plus-core@1.3.0                       | Prerendered HTML + React hydration (TanStack Start) | `vp build`                |

## Failures

None recorded.

Raw samples and environment: [results/latest.json](./results/latest.json). Reproduction: [README](./README.md).
