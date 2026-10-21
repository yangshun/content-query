# ContentQuery full-site benchmarks

Run: 2026-10-21T03:15:45.170Z. Completed: 2026-10-21T03:24:34.805Z.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across benchmark apps (60000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Selected stacks: Astro collections, Void + ContentQuery, TanStack Start + ContentQuery.

Void and its React adapter use the saved local optimization branch at `333e0a89`, identified by the package fingerprints below. The original published dependency links were restored after the run.

Validation: 36/36 recorded samples passed. 18/18 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./results/single-page-RESULTS.md) and [raw samples](./results/single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                         |          Content usable |        Production build |
| ----------------------------- | ----------------------: | ----------------------: |
| Void + ContentQuery           | 3.49 (3.22–3.52; n=3/3) | 5.21 (5.16–6.71; n=3/3) |
| Astro collections             | 3.28 (3.12–3.51; n=3/3) | 4.22 (4.08–4.39; n=3/3) |
| TanStack Start + ContentQuery | 2.54 (2.43–3.05; n=3/3) | 5.62 (5.26–6.49; n=3/3) |

### Warm

| Stack                         |          Content usable |        Production build |
| ----------------------------- | ----------------------: | ----------------------: |
| Void + ContentQuery           | 2.69 (2.65–2.79; n=3/3) | 6.72 (6.57–7.49; n=3/3) |
| Astro collections             | 3.17 (2.68–3.20; n=3/3) | 5.76 (5.29–5.91; n=3/3) |
| TanStack Start + ContentQuery | 2.32 (2.23–2.36; n=3/3) | 7.32 (7.32–8.14; n=3/3) |

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

App order was shuffled independently for each repetition with seed `2026102137`:

1. void, tanstack-start, astro
2. tanstack-start, astro, void
3. astro, void, tanstack-start

Before every sample, the runner waited until host CPU was at least 80% idle, averaged over 3 consecutive 1-second windows, for up to 180 seconds. 36/36 samples started on a settled host. Median idle before a sample: 82% (80%–86%); median wait: 4.0 s (maximum 43.0 s).

Spotlight did not index new files under the applications directory during this run.

## Environment

- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `f89c9901745ee1d37b8efd11851988ffcd72db9b`; uncommitted changes: true.
- Lockfile SHA-256: `1cd9c6068cfd180103c137c08011c70e01f2103a158d5eb5cdfaabcfe9c9605e`.
- Built ContentQuery JavaScript SHA-256: `453769f7d14da55d1ba2a3c9c8e77186b10343b9114d928df5827014b761c290`; unchanged during measurement: true.
- Built Void JavaScript SHA-256: `07915e66216273d57fc37ba5f987f640d9ca32f254df078f9aa48b7e225efe2d`; package directory: `../../voidzero/void/packages/void`. Source revision: `333e0a89b5a29154d52062bfc6dd66365b97e861`; uncommitted package changes: false.
- Built @void/react JavaScript SHA-256: `14e2915395116c95a3e2f64e6185b7e1bf251b56decadadbca55d879d0119953`; package directory: `../../voidzero/void/packages/react`.

```text
vp v1.3.0

Local vite-plus:
  vite-plus  v0.1.16

Tools:
  vite             v8.0.5
  rolldown         v1.0.0-rc.13
  vitest           v4.1.4
  oxfmt            v0.43.0
  oxlint           v1.58.0
  oxlint-tsgolint  v0.20.0
  tsdown           v0.21.7

Environment:
  Package manager  pnpm v10.28.1
  Node.js          v24.21.0 (VP_NODE_VERSION)
```

## Versions and output

| Stack                         | Resolved packages                                                                                                                                                        | Normal output                                       | Command               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------- |
| Astro collections             | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                        | Static HTML                                         | `vp exec astro build` |
| Void + ContentQuery           | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@1.3.0, @voidzero-dev/vite-plus-core@1.3.0                                                  | Static HTML + bundled content                       | `vp build`            |
| TanStack Start + ContentQuery | @tanstack/react-start@1.169.3, @tanstack/react-router@1.170.45, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@1.3.0, @voidzero-dev/vite-plus-core@1.3.0 | Prerendered HTML + React hydration (TanStack Start) | `vp build`            |

## Failures

None recorded.

Raw samples and environment: [results/latest.json](./results/latest.json). Reproduction: [README](./README.md).
