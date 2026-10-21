# ContentQuery full-site benchmarks

Run: 2026-10-20T14:57:38.962Z. Completed: 2026-10-20T15:33:46.440Z.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across benchmark apps (60000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Validation: 72/72 recorded samples passed. 36/36 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./single-page-RESULTS.md) and [raw samples](./single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                              |             Content usable |           Production build |
| ---------------------------------- | -------------------------: | -------------------------: |
| Void + ContentQuery                |    5.08 (4.79–5.46; n=3/3) |   8.78 (8.50–10.19; n=3/3) |
| Astro collections                  |    4.37 (3.27–5.67; n=3/3) |    5.82 (5.72–5.89; n=3/3) |
| TanStack Start + ContentQuery      |    3.73 (3.58–3.81; n=3/3) |    9.10 (7.51–9.34; n=3/3) |
| Vite + React + Content Collections |    9.18 (8.56–9.37; n=3/3) |    7.71 (7.28–8.18; n=3/3) |
| Nuxt Content                       | 16.53 (16.49–18.64; n=3/3) | 56.30 (54.95–59.12; n=3/3) |
| Next.js + ContentQuery             | 19.74 (18.36–20.62; n=3/3) | 37.30 (35.73–39.50; n=3/3) |

### Warm

| Stack                              |             Content usable |           Production build |
| ---------------------------------- | -------------------------: | -------------------------: |
| Void + ContentQuery                |    4.03 (3.78–4.20; n=3/3) |  10.63 (9.82–11.55; n=3/3) |
| Astro collections                  |    5.76 (5.58–5.82; n=3/3) |    6.85 (6.80–7.03; n=3/3) |
| TanStack Start + ContentQuery      |    3.08 (3.02–3.64; n=3/3) |    8.13 (8.13–8.17; n=3/3) |
| Vite + React + Content Collections |    6.40 (6.21–6.91; n=3/3) |    7.68 (7.03–9.79; n=3/3) |
| Nuxt Content                       |    5.77 (5.58–8.87; n=3/3) | 58.39 (58.00–60.22; n=3/3) |
| Next.js + ContentQuery             | 15.13 (13.76–16.39; n=3/3) | 41.96 (41.30–43.55; n=3/3) |

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

App order was shuffled independently for each repetition with seed `1506779684`:

1. void, vite-react, tanstack-start, astro, next, nuxt
2. astro, tanstack-start, next, void, nuxt, vite-react
3. tanstack-start, nuxt, astro, vite-react, void, next

Before every sample, the runner waited until host CPU was at least 80% idle, averaged over 3 consecutive 1-second windows, for up to 180 seconds. 72/72 samples started on a settled host. Median idle before a sample: 81% (80%–88%); median wait: 7.0 s (maximum 73.1 s).

Spotlight did not index new files under the applications directory during this run.

## Environment

- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `2bbf6b5a9cea6e4424629dc56861e66e43a74bf2`; uncommitted changes: false.
- Lockfile SHA-256: `bc316524fd84e55b06609f1363f6fdfbf3ac9182050b1864ce2bf598a94b94cc`.
- Built ContentQuery JavaScript SHA-256: `3513d0efd290a2dd6923b255f18511bc75af10a8618a6c699830dd3088345c44`; unchanged during measurement: true.

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
| Void + ContentQuery                | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                                     | Static HTML + bundled content                       | `vp build`                |
| Next.js + ContentQuery             | next@16.4.2, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@0.1.16                                                                                                            | Static HTML + RSC payloads (Next.js export)         | `vp exec next build`      |
| TanStack Start + ContentQuery      | @tanstack/react-start@1.169.3, @tanstack/react-router@1.170.45, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@1.3.0, @voidzero-dev/vite-plus-core@1.3.0                      | Prerendered HTML + React hydration (TanStack Start) | `vp build`                |

## Failures

None recorded.

Raw samples and environment: [core-baseline-20261020.json](./core-baseline-20261020.json). Reproduction: [README](../README.md).
