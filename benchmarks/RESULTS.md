# ContentQuery full-site benchmarks

Comparison updated: 2026-10-20T06:01:50.406Z. Only Astro was rerun; TanStack Start is newly measured. Void, Vite + React, Nuxt, and Next.js retain their original 48 samples.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across benchmark apps (60000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Validation: 69/72 recorded samples passed. 36/36 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./results/single-page-RESULTS.md) and [raw samples](./results/single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                              |             Content usable |           Production build |
| ---------------------------------- | -------------------------: | -------------------------: |
| Void + ContentQuery                |    7.04 (6.29–9.11; n=3/3) | 16.57 (12.44–19.93; n=3/3) |
| Astro collections                  |    4.76 (4.61–4.92; n=2/3) |   7.65 (6.55–13.54; n=3/3) |
| TanStack Start + ContentQuery      |    4.11 (4.02–4.79; n=3/3) |    7.43 (6.44–8.22; n=3/3) |
| Vite + React + Content Collections | 11.13 (10.85–13.08; n=3/3) |   9.13 (9.12–10.37; n=3/3) |
| Nuxt Content                       | 19.58 (18.77–39.36; n=3/3) | 69.71 (67.19–82.51; n=3/3) |
| Next.js + ContentQuery             | 21.56 (21.18–30.15; n=3/3) | 40.02 (37.22–48.09; n=3/3) |

### Warm

| Stack                              |             Content usable |           Production build |
| ---------------------------------- | -------------------------: | -------------------------: |
| Void + ContentQuery                |    5.50 (4.52–5.70; n=3/3) | 17.87 (12.01–19.31; n=3/3) |
| Astro collections                  |    4.07 (4.07–4.07; n=1/3) |    8.32 (7.94–9.93; n=3/3) |
| TanStack Start + ContentQuery      |    3.19 (3.12–3.95; n=3/3) |   9.57 (8.41–11.99; n=3/3) |
| Vite + React + Content Collections | 11.36 (11.04–12.00; n=3/3) |   8.58 (8.26–12.54; n=3/3) |
| Nuxt Content                       |   6.90 (6.27–23.47; n=3/3) | 64.09 (62.62–64.41; n=3/3) |
| Next.js + ContentQuery             | 15.39 (15.28–16.34; n=3/3) | 58.29 (49.38–60.60; n=3/3) |

## Method

- Three cold/warm pairs by default. Only one framework and measurement type (startup or build) runs at a time, rotating app order between repetitions. Each server, build, and validation preview is shut down before the next sample starts. No Vite task-result cache is used.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.
- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, Void uses getPrerenderPaths(), Next.js uses generateStaticParams() with output: export, and TanStack Start uses its native prerender link crawler. Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.
- Results compare complete application stacks under this workspace's Vite+ configuration. Next.js uses its native Turbopack bundler; Vite-based stacks inherit the workspace dependency overrides. All apps produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ. ContentQuery's Next.js adapter uses generated artifacts; its Vite adapter defaults to in-memory storage.

## Measurement sources

Each source ran one framework and measurement type at a time. Partial reruns reused the corpus and preserved other frameworks' samples. Original Astro timeouts remain in the archived five-framework run; current failures below come from the new Astro run.

- **void, vite-react, nuxt, next**: 2026-10-20T04:53:08.063Z–2026-10-20T05:26:13.705Z. [Raw source](./results/full-site-sequential-20261020.json). Node v24.21.0; lockfile SHA-256: `4124699dc039ebe02e7da114162d4c2c5af11c5c8b87f5f49e172dc70782804c`; built ContentQuery SHA-256: `fc104e63574fb1c3d01c6ce7b46ab4381e1226bc922a7de9943189e0776f9926`.
- **astro**: 2026-10-20T05:32:56.841Z–2026-10-20T05:49:16.043Z. [Raw source](./results/astro-rerun-20261020.json). Node v24.21.0; lockfile SHA-256: `4124699dc039ebe02e7da114162d4c2c5af11c5c8b87f5f49e172dc70782804c`; built ContentQuery SHA-256: `fc104e63574fb1c3d01c6ce7b46ab4381e1226bc922a7de9943189e0776f9926`.
- **tanstack-start**: 2026-10-20T06:00:25.061Z–2026-10-20T06:01:50.406Z. [Raw source](./results/tanstack-start-20261020.json). Node v24.21.0; lockfile SHA-256: `6d1776a6d25e47714e6bc508aefb855354214af33be9465c37d347942584a674`; built ContentQuery SHA-256: `fc104e63574fb1c3d01c6ce7b46ab4381e1226bc922a7de9943189e0776f9926`.

## Environment

The base environment below describes the original five-framework run. Per-run environments and package fingerprints are retained above and in the raw comparison. The original host remained busy with Spotlight and VS Code; its post-run one-second CPU sample was 15.59% idle.

- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `0621349ee7d18d04e32069a36d4ea4421ce17ce1`; uncommitted changes: true.
- Lockfile SHA-256: `4124699dc039ebe02e7da114162d4c2c5af11c5c8b87f5f49e172dc70782804c`.
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
| TanStack Start + ContentQuery      | @tanstack/react-start@1.169.3, @tanstack/react-router@1.170.45, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@1.3.0, @voidzero-dev/vite-plus-core@0.1.24                      | Prerendered HTML + React hydration (TanStack Start) | `vp build`                |

## Failures

- astro, startup, warm, repetition 1: **timeout**. Log: `.runs/2026-10-20T05-32-56-841Z/1-astro-startup-warm.log`.

```text
page.goto: Timeout 296242.15112500003ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:58961/", waiting until "load"

Server output:
{"message":"connected.","label":"vite","level":"info"}
{"message":"Generated 0ms","label":"types","level":"info"}
{"message":"connected.","label":"vite","level":"info"}
{"message":"Syncing content","label":"content","level":"info"}
{"message":"Astro config changed","label":"content","level":"info"}
{"message":"Clearing content store","label":"content","level":"info"}
{"message":"Synced content","label":"content","level":"info"}
{"message":" astro  v7.4.0 ready in 2524 ms\n┃ Local    http://127.0.0.1:58961/","label":"SKIP_FORMAT","level":"info"}
{"message":"watching for file changes...","label":null,"level":"info"}
{"message":"[200] / 530ms","label":null,"level":"info"}
{"message":"[200] / 14ms","label":null,"level":"info"}
{"message":"[200] /entries/entry-00001/ 29ms","label":null,"level":"info"}

```

- astro, startup, cold, repetition 3: **timeout**. Log: `.runs/2026-10-20T05-32-56-841Z/3-astro-startup-cold.log`.

```text
page.goto: Timeout 295699.12362499995ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:60523/", waiting until "load"

Server output:
{"message":"connected.","label":"vite","level":"info"}
{"message":"Generated 1ms","label":"types","level":"info"}
{"message":"connected.","label":"vite","level":"info"}
{"message":"Syncing content","label":"content","level":"info"}
{"message":"Synced content","label":"content","level":"info"}
{"message":" astro  v7.4.0 ready in 2765 ms\n┃ Local    http://127.0.0.1:60523/","label":"SKIP_FORMAT","level":"info"}
{"message":"watching for file changes...","label":null,"level":"info"}
{"message":"[200] / 472ms","label":null,"level":"info"}
{"message":"[200] / 12ms","label":null,"level":"info"}
{"message":"[200] /entries/entry-00001/ 27ms","label":null,"level":"info"}

```

- astro, startup, warm, repetition 3: **timeout**. Log: `.runs/2026-10-20T05-32-56-841Z/3-astro-startup-warm.log`.

```text
page.goto: Timeout 293243.20233400003ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:61232/", waiting until "load"

Server output:
{"message":"connected.","label":"vite","level":"info"}
{"message":"Generated 0ms","label":"types","level":"info"}
{"message":"connected.","label":"vite","level":"info"}
{"message":"Syncing content","label":"content","level":"info"}
{"message":"Astro config changed","label":"content","level":"info"}
{"message":"Clearing content store","label":"content","level":"info"}
{"message":"Synced content","label":"content","level":"info"}
{"message":" astro  v7.4.0 ready in 5495 ms\n┃ Local    http://127.0.0.1:61232/","label":"SKIP_FORMAT","level":"info"}
{"message":"watching for file changes...","label":null,"level":"info"}
{"message":"[200] / 440ms","label":null,"level":"info"}
{"message":"[200] / 7ms","label":null,"level":"info"}
{"message":"[200] /entries/entry-00001/ 15ms","label":null,"level":"info"}

```

The [original five-framework comparison](./results/full-site-sequential-20261020-RESULTS.md) and [earlier report](./results/pre-sequential-20261020-RESULTS.md) remain archived.

Raw samples and environment: [results/latest.json](./results/latest.json). Reproduction: [README](./README.md).
