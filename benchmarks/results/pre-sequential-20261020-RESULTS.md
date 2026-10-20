# ContentQuery full-site benchmarks

Original four-stack run: 2026-10-20T02:09:50.802Z–2026-10-20T02:29:18.857Z. Previous Void in-memory run: 2026-10-20T02:38:00.137Z–2026-10-20T02:40:47.073Z. Previous Void ID-index run, with concurrent Next.js work: 2026-10-20T03:23:59.226Z–2026-10-20T03:27:53.547Z. Latest Void rerun after Next.js stopped: 2026-10-20T03:44:53.542Z–2026-10-20T03:46:46.121Z.

Only Void + ContentQuery was rerun. Astro, React, and Nuxt retain their original measurements. Each row's source environment and dates are preserved in the [combined raw comparison](./pre-sequential-20261020.json).

The latest Void rows include the ContentQuery ID-query index identified by the [full-site build profile](../BUILD-PROFILING.md), with Void code unchanged. The [new raw samples](./profile-void-no-next-20261020.json) were collected after Next.js stopped, without profiling instrumentation. The existing corpus was reused without regenerating any app's content. The [previous run with concurrent Next.js work](./profile-void-id-index-refresh-20261020.json) remains archived.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across four apps (40000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Validation: 47/48 samples in the combined comparison passed; 24/24 production builds verified all 10,001 content HTML pages. The new Void run passed 12/12 samples, including all six builds. The Astro startup timeout is retained from the original run and excluded from summaries.

The [historical single-page report](./single-page-RESULTS.md) and [raw samples](./single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                              |           Server listening |                Content usable |              Production build |
| ---------------------------------- | -------------------------: | ----------------------------: | ----------------------------: |
| Void + ContentQuery                | 4.515 (4.460–5.085; n=3/3) |    6.135 (5.983–6.976; n=3/3) | 10.348 (10.189–12.148; n=3/3) |
| Astro collections                  | 4.762 (3.067–6.457; n=2/3) |    6.226 (3.946–8.506; n=2/3) |    5.005 (4.228–5.561; n=3/3) |
| Vite + React + Content Collections | 6.069 (5.867–6.423; n=3/3) | 12.872 (11.806–14.210; n=3/3) |   9.581 (9.024–11.005; n=3/3) |
| Nuxt Content                       | 0.179 (0.178–0.242; n=3/3) | 18.088 (17.411–19.643; n=3/3) | 62.098 (59.362–72.291; n=3/3) |
| Next.js + ContentQuery             | 1.176 (0.840–1.411; n=3/3) | 42.032 (35.777–62.044; n=3/3) | 81.114 (70.220–92.008; n=2/3) |

### Warm

| Stack                              |           Server listening |                Content usable |                Production build |
| ---------------------------------- | -------------------------: | ----------------------------: | ------------------------------: |
| Void + ContentQuery                | 3.404 (3.190–4.103; n=3/3) |    4.647 (4.587–5.563; n=3/3) |   11.588 (11.465–14.617; n=3/3) |
| Astro collections                  | 2.692 (2.479–3.828; n=3/3) |    3.526 (3.324–4.968; n=3/3) |      6.790 (6.282–7.782; n=3/3) |
| Vite + React + Content Collections | 2.995 (2.980–4.544; n=3/3) |   8.734 (7.504–16.959; n=3/3) |      8.246 (7.918–9.337; n=3/3) |
| Nuxt Content                       | 0.155 (0.150–0.156; n=3/3) |    6.302 (5.990–6.394; n=3/3) |   68.267 (61.025–69.270; n=3/3) |
| Next.js + ContentQuery             | 0.405 (0.385–0.425; n=2/3) | 33.426 (33.270–33.582; n=2/3) | 101.192 (98.716–103.669; n=2/3) |

**Next.js benchmark in progress: 9/12 samples recorded.** Its cells show current medians and ranges from the [separate Next.js run](./full-site-next.json), with final targets of three cold/warm pairs for startup and build. The other four stacks and their current sample totals above are preserved. The earlier single build validation is excluded.

## Void rerun comparison

Median seconds for the same full-site workload. The latest rerun uses exactly the same compiled ContentQuery package and lockfile as the preceding ID-index run.

| Measurement   | Generated (previous) | In-memory (previous) | ID index, concurrent Next.js | ID index, Next.js stopped (latest) |
| ------------- | -------------------: | -------------------: | ---------------------------: | ---------------------------------: |
| Startup, cold |                8.697 |                5.478 |                       14.329 |                              6.135 |
| Startup, warm |                5.032 |                4.943 |                        7.137 |                              4.647 |
| Build, cold   |               17.029 |               17.551 |                       20.762 |                             10.348 |
| Build, warm   |               16.252 |               18.671 |                       32.452 |                             11.588 |

The user confirmed that Next.js was running during the preceding Void measurement. No Next.js build or development process was found in the latest run's preflight, mid-run, or post-run checks. Preflight CPU idle reached 66.56%; the one-minute load average was 17.20 at the start and 13.38 at the end on 10 logical CPUs. Spotlight, VS Code, and paging activity were still present, so this was not an idle-machine benchmark. The process observations and preflight host summary are included in the raw data.

The latest in-memory run emitted only `types.d.ts` under `.content-query/`; article payloads remain bundled with the application. The original generated-backend run additionally wrote standalone runtime artifacts. Sources: [generated-backend report](./full-site-generated-RESULTS.md), [previous in-memory samples](./full-site-in-memory.json), [ID-index run with concurrent Next.js](./profile-void-id-index-refresh-20261020.json), and [latest Void samples after Next.js stopped](./profile-void-no-next-20261020.json).

## Method

- Three cold/warm pairs for the original four stacks. The original run rotated all four apps between repetitions; the follow-up ran only Void, sequentially, with the in-memory backend. Next.js currently has only the single cold build validation described above. No Vite task-result cache is used.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.
- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, and Void uses getPrerenderPaths(). Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.
- Results compare complete application stacks under this workspace's Vite+ dependency overrides. All four produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ.

## Environment

### Latest Void rerun

- Backend: `in-memory`, with the lazy ID-query index. Only Void was measured; all 12 samples passed and all six builds verified 10,001 content HTML pages.
- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0; CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `ad97f39096e3ceaec39078bd0e0c2bb8dd37687f`; uncommitted changes: true.
- Lockfile SHA-256: `4124699dc039ebe02e7da114162d4c2c5af11c5c8b87f5f49e172dc70782804c`; identical to the preceding ID-index run.
- Built ContentQuery JavaScript SHA-256: `da14c14bc1950629e891ad56103b6dd34c07c85751547410c23a94227b67183d`; identical to the preceding ID-index run and unchanged throughout the measurement sequence.
- Vite+ CLI: 1.3.0; local `vite-plus`: 0.1.16; Vite: 8.0.5; Rolldown: 1.0.0-rc.13. Complete tool versions and host observations are in the [raw run](./profile-void-no-next-20261020.json).
- Invocation: `vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode timings --backend in-memory --label void-no-next-20261020 --phase all --runs 3`.

### Archived comparison runs

- The original four-stack and previous Void in-memory runs used the environment below. The archived original Void measurements used `generated`; the previous Void rerun used `in-memory`. Other stacks retain their original measurements and source environments.
- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Git revision: `9dca5650ae7fc7b1b49a997137fc33ba3b2030d8`; uncommitted changes: true.
- Lockfile SHA-256: `b90d85129234e2432256377d17a7c5a4441d9d6419158699568bdb0986050a99`.
- Built ContentQuery JavaScript SHA-256: `903b5589411f1c74cc4e39e69ada5cc870dc4e151f9fd0604e2646159cb7d231`; unchanged during the Void rerun: true.

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

| Stack                              | Resolved packages                                                                                                                                                                             | Normal output                                             | Command                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| Astro collections                  | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                                             | Static HTML                                               | `vp exec astro build`     |
| Vite + React + Content Collections | react@19.2.5, react-dom@19.2.5, @content-collections/core@0.15.3, @content-collections/vite@0.3.1, @content-collections/markdown@0.1.4, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16 | Prerendered HTML + React hydration (Vite SSR/SSG)         | `vp run --no-cache build` |
| Nuxt Content                       | nuxt@4.6.2, vue@3.5.44, @nuxt/content@3.16.2, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                            | Prerendered HTML + Nuxt payloads (nuxt generate)          | `vp exec nuxt generate`   |
| Void + ContentQuery                | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                                     | Static HTML + bundled content (in-memory)                 | `vp build`                |
| Next.js + ContentQuery             | next@16.4.2, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@0.1.16                                                                                                            | Static HTML + RSC payloads (generated content; Turbopack) | `vp exec next build`      |

## Failures

The new Void rerun recorded no failures. The following failure is retained from the original comparison.

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

Raw comparison and source environments: [results/latest.json](./pre-sequential-20261020.json). Source runs: [original four-stack run](./full-site-generated.json), [previous Void in-memory run](./full-site-in-memory.json), [previous ID-index run with concurrent Next.js](./profile-void-id-index-refresh-20261020.json), [latest Void rerun after Next.js stopped](./profile-void-no-next-20261020.json). Reproduction: [README](../README.md).
