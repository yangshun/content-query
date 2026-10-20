# ContentQuery full-site benchmarks

Run: 2026-10-20T04:53:08.063Z. Completed: 2026-10-20T05:26:13.705Z.

10,000 unique Markdown entries, 10,368,894 bytes total, shared across benchmark apps (50000 hardlinks, 0 copies). Corpus SHA-256: `643790e071889ba794ccca7a44872a07ac6507438317b6620d17d3d47d533914`.

Workload: `full-index-and-prerendered-articles`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: 10,001 content HTML pages per successful build. Native error pages and auxiliary assets are additional output.

Validation: 58/60 recorded samples passed. 30/30 recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.

The [historical single-page report](./single-page-RESULTS.md) and [raw samples](./single-page.json) cover the previous workload and are not directly comparable.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.

### Cold

| Stack                              |           Server listening |                Content usable |              Production build |
| ---------------------------------- | -------------------------: | ----------------------------: | ----------------------------: |
| Void + ContentQuery                | 5.483 (4.710–5.904; n=3/3) |    7.041 (6.288–9.112; n=3/3) | 16.574 (12.442–19.931; n=3/3) |
| Astro collections                  | 4.230 (4.230–4.230; n=1/3) |    5.331 (5.331–5.331; n=1/3) |    5.787 (4.908–7.143; n=3/3) |
| Vite + React + Content Collections | 6.321 (5.943–6.436; n=3/3) | 11.128 (10.851–13.082; n=3/3) |   9.133 (9.117–10.369; n=3/3) |
| Nuxt Content                       | 0.253 (0.236–0.535; n=3/3) | 19.584 (18.774–39.358; n=3/3) | 69.709 (67.190–82.507; n=3/3) |
| Next.js + ContentQuery             | 0.634 (0.484–1.080; n=3/3) | 21.563 (21.185–30.152; n=3/3) | 40.018 (37.218–48.093; n=3/3) |

### Warm

| Stack                              |           Server listening |                Content usable |              Production build |
| ---------------------------------- | -------------------------: | ----------------------------: | ----------------------------: |
| Void + ContentQuery                | 3.919 (3.301–4.179; n=3/3) |    5.496 (4.519–5.705; n=3/3) | 17.874 (12.010–19.314; n=3/3) |
| Astro collections                  | 2.956 (2.860–4.900; n=3/3) |    3.930 (3.799–6.177; n=3/3) |   7.087 (5.742–10.557; n=3/3) |
| Vite + React + Content Collections | 3.227 (3.077–3.537; n=3/3) | 11.364 (11.043–12.002; n=3/3) |   8.578 (8.265–12.542; n=3/3) |
| Nuxt Content                       | 0.181 (0.174–0.192; n=3/3) |   6.901 (6.268–23.472; n=3/3) | 64.087 (62.619–64.412; n=3/3) |
| Next.js + ContentQuery             | 0.326 (0.324–0.344; n=3/3) | 15.385 (15.285–16.342; n=3/3) | 58.291 (49.381–60.604; n=3/3) |

## Method

- Three cold/warm pairs by default. Only one framework and measurement type (startup or build) runs at a time, rotating app order between repetitions. Each server, build, and validation preview is shut down before the next sample starts. No Vite task-result cache is used.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.
- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, Void uses getPrerenderPaths(), and Next.js uses generateStaticParams() with output: export. Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.
- Results compare complete application stacks under this workspace's Vite+ configuration. Next.js uses its native Turbopack bundler; Vite-based stacks inherit the workspace dependency overrides. All apps produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ. ContentQuery's Next.js adapter uses generated artifacts; its Vite adapter defaults to in-memory storage.

## Environment

- Invocation: `CONTENT_QUERY_BENCH_BACKEND=in-memory vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench --apps void,astro,vite-react,nuxt,next --phase all --runs 3`.
- The runner serialized every framework and measurement type; process snapshots found no other active framework benchmark after the restart. Background system activity remained: a post-run one-second sample showed 15.59% CPU idle, load average 21.25 on 10 logical CPUs, and 23 GiB physical memory used with about 9.1 GiB compressed. Spotlight and VS Code were active. These are not idle-host measurements; raw data includes the observations.
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

| Stack                              | Resolved packages                                                                                                                                                                             | Normal output                                     | Command                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| Astro collections                  | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                                             | Static HTML                                       | `vp exec astro build`     |
| Vite + React + Content Collections | react@19.2.5, react-dom@19.2.5, @content-collections/core@0.15.3, @content-collections/vite@0.3.1, @content-collections/markdown@0.1.4, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16 | Prerendered HTML + React hydration (Vite SSR/SSG) | `vp run --no-cache build` |
| Nuxt Content                       | nuxt@4.6.2, vue@3.5.44, @nuxt/content@3.16.2, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                            | Prerendered HTML + Nuxt payloads (nuxt generate)  | `vp exec nuxt generate`   |
| Void + ContentQuery                | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                                     | Static HTML + bundled content                     | `vp build`                |
| Next.js + ContentQuery             | next@16.4.2, react@19.2.5, react-dom@19.2.5, content-query@0.0.0, vite-plus@0.1.16                                                                                                            | Static HTML + RSC payloads (Next.js export)       | `vp exec next build`      |

## Failures

- astro, startup, cold, repetition 1: **timeout**. Log: `.runs/2026-10-20T04-53-08-063Z/1-astro-startup-cold.log`.

```text
page.goto: Timeout 296068.9355ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:62471/", waiting until "load"

Server output:
{"message":"connected.","label":"vite","level":"info"}
{"message":"Generated 0ms","label":"types","level":"info"}
{"message":"connected.","label":"vite","level":"info"}
{"message":"Syncing content","label":"content","level":"info"}
{"message":"Synced content","label":"content","level":"info"}
{"message":" astro  v7.4.0 ready in 2375 ms\n┃ Local    http://127.0.0.1:62471/","label":"SKIP_FORMAT","level":"info"}
{"message":"watching for file changes...","label":null,"level":"info"}
{"message":"[200] / 445ms","label":null,"level":"info"}
{"message":"[200] / 25ms","label":null,"level":"info"}
{"message":"[200] /entries/entry-00001/ 79ms","label":null,"level":"info"}

```

- astro, startup, cold, repetition 2: **timeout**. Log: `.runs/2026-10-20T04-53-08-063Z/2-astro-startup-cold.log`.

```text
page.goto: Timeout 295640.951333ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:65146/", waiting until "load"

Server output:
{"message":"connected.","label":"vite","level":"info"}
{"message":"Generated 0ms","label":"types","level":"info"}
{"message":"connected.","label":"vite","level":"info"}
{"message":"Syncing content","label":"content","level":"info"}
{"message":"Synced content","label":"content","level":"info"}
{"message":" astro  v7.4.0 ready in 2721 ms\n┃ Local    http://127.0.0.1:65146/","label":"SKIP_FORMAT","level":"info"}
{"message":"watching for file changes...","label":null,"level":"info"}
{"message":"[200] / 524ms","label":null,"level":"info"}
{"message":"[200] / 9ms","label":null,"level":"info"}
{"message":"[200] /entries/entry-00001/ 29ms","label":null,"level":"info"}

```

This complete rerun replaces every framework's previous measurements. The [previous comparison](./pre-sequential-20261020-RESULTS.md) remains archived. An [interrupted attempt](./interrupted-sequential-20261020.json), stopped when another Void benchmark started, is excluded.

Run archive: [raw measurements](./full-site-sequential-20261020.json).

Raw samples and environment: [results/latest.json](./full-site-sequential-20261020.json). Reproduction: [README](../README.md).
