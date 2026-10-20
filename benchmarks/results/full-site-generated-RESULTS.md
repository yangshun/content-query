# ContentQuery full-site benchmarks

Run: 2026-10-20T02:09:50.802Z. Completed: 2026-10-20T02:29:18.857Z.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across four apps (40000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Validation: 47/48 recorded samples passed. 24/24 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./single-page-RESULTS.md) and [raw samples](./single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

| Stack                              | Cache |           Server listening |                Content usable |              Production build |
| ---------------------------------- | ----- | -------------------------: | ----------------------------: | ----------------------------: |
| Astro collections                  | cold  | 4.762 (3.067–6.457; n=2/3) |    6.226 (3.946–8.506; n=2/3) |    5.005 (4.228–5.561; n=3/3) |
| Astro collections                  | warm  | 2.692 (2.479–3.828; n=3/3) |    3.526 (3.324–4.968; n=3/3) |    6.790 (6.282–7.782; n=3/3) |
| Vite + React + Content Collections | cold  | 6.069 (5.867–6.423; n=3/3) | 12.872 (11.806–14.210; n=3/3) |   9.581 (9.024–11.005; n=3/3) |
| Vite + React + Content Collections | warm  | 2.995 (2.980–4.544; n=3/3) |   8.734 (7.504–16.959; n=3/3) |    8.246 (7.918–9.337; n=3/3) |
| Nuxt Content                       | cold  | 0.179 (0.178–0.242; n=3/3) | 18.088 (17.411–19.643; n=3/3) | 62.098 (59.362–72.291; n=3/3) |
| Nuxt Content                       | warm  | 0.155 (0.150–0.156; n=3/3) |    6.302 (5.990–6.394; n=3/3) | 68.267 (61.025–69.270; n=3/3) |
| Void + ContentQuery                | cold  | 7.489 (7.362–8.594; n=3/3) |   8.697 (8.546–12.159; n=3/3) | 17.029 (16.777–18.593; n=3/3) |
| Void + ContentQuery                | warm  | 3.895 (3.273–5.207; n=3/3) |    5.032 (4.409–6.327; n=3/3) | 16.252 (15.428–17.634; n=3/3) |

## Method

- Three cold/warm pairs by default. Apps run sequentially, rotating their order between repetitions. No Vite task-result cache is used.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.
- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, and Void uses getPrerenderPaths(). Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.
- Results compare complete application stacks under this workspace's Vite+ dependency overrides. All four produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ.

## Environment

- ContentQuery backend: `generated`. The Vite plugin default changed to `in-memory` after this run; set `CONTENT_QUERY_BENCH_BACKEND=generated` to reproduce this configuration.
- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `9dca5650ae7fc7b1b49a997137fc33ba3b2030d8`; uncommitted changes: true.
- Lockfile SHA-256: `b90d85129234e2432256377d17a7c5a4441d9d6419158699568bdb0986050a99`.
- Built ContentQuery JavaScript SHA-256: `394ac9681bdd845a4b48771c53922ccc3ab2e3ad8a4550aa4d9a0813be7ce15c`; unchanged during measurement: true.

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

| Stack                              | Resolved packages                                                                                                                                                                             | Normal output                                     | Command                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| Astro collections                  | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                                             | Static HTML                                       | `vp exec astro build`     |
| Vite + React + Content Collections | react@19.2.5, react-dom@19.2.5, @content-collections/core@0.15.3, @content-collections/vite@0.3.1, @content-collections/markdown@0.1.4, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16 | Prerendered HTML + React hydration (Vite SSR/SSG) | `vp run --no-cache build` |
| Nuxt Content                       | nuxt@4.6.2, vue@3.5.44, @nuxt/content@3.16.2, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                            | Prerendered HTML + Nuxt payloads (nuxt generate)  | `vp exec nuxt generate`   |
| Void + ContentQuery                | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                                     | Static HTML + content artifacts                   | `vp build`                |

## Failures

- astro, startup, cold, repetition 3: **timeout**. Log: `.runs/2026-10-20T02-09-50-802Z/3-astro-startup-cold.log`.

```text
page.goto: Timeout 296267.7485829998ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:57609/", waiting until "load"

Server output:
{"message":"connected.","label":"vite","level":"info"}
{"message":"Generated 1ms","label":"types","level":"info"}
{"message":"connected.","label":"vite","level":"info"}
{"message":"Syncing content","label":"content","level":"info"}
{"message":"Synced content","label":"content","level":"info"}
{"message":" astro  v7.4.0 ready in 2190 ms\n┃ Local    http://127.0.0.1:57609/","label":"SKIP_FORMAT","level":"info"}
{"message":"watching for file changes...","label":null,"level":"info"}
{"message":"[200] / 418ms","label":null,"level":"info"}
{"message":"[200] / 11ms","label":null,"level":"info"}
{"message":"[200] /entries/entry-00001/ 20ms","label":null,"level":"info"}

```

Raw samples and environment: [full-site-generated.json](./full-site-generated.json). Reproduction: [README](../README.md).
