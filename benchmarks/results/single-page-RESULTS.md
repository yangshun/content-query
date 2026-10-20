# Historical single-page benchmark results

Updated October 20, 2026 with the optimized Void + ContentQuery results, using its default generated backend. Astro, Vite + React, and Nuxt retain their original measurements. All rows use the same corpus, machine, Node version, and dependency lockfile.

- Original four-stack run: 2026-10-19T15:07:25.282Z–2026-10-19T15:22:06.720Z. [Raw baseline](./single-page.json).
- Optimized Void follow-up: 2026-10-20T00:52:30.682Z–2026-10-20T00:54:08.793Z. [Raw samples](./profile-final-stable.json).

These are separate measurement sessions, with three cold/warm pairs per phase. System load varied during profiling; the updated table is not a simultaneous rerun of all four stacks. The [profiling report](../PROFILING.md) retains the other timing cohorts, CPU attribution, and optimization details.

10,000 unique Markdown entries, 10,248,894 bytes total, shared across four apps (40000 hardlinks, 0 copies). Corpus SHA-256: `591f5510c25529afdf3e999f7586c3d30a39120239131572460c7208fd8f19f4`.

## Timings

Seconds, shown as median (minimum–maximum; successful samples / requested samples). Each app loads the entire collection, shows the first 20 titles and final title, and renders the first article on one page.

| Stack                              | Cache |           Server listening |                Content usable |              Production build |
| ---------------------------------- | ----- | -------------------------: | ----------------------------: | ----------------------------: |
| Astro collections                  | cold  | 3.053 (2.843–3.490; n=3/3) |    3.602 (3.358–4.466; n=3/3) |    2.493 (2.349–2.584; n=3/3) |
| Astro collections                  | warm  | 2.586 (2.440–2.977; n=3/3) |    3.133 (2.931–3.510; n=3/3) |    2.080 (1.932–2.118; n=3/3) |
| Vite + React + Content Collections | cold  | 6.786 (6.275–7.389; n=3/3) |    7.401 (6.887–8.129; n=3/3) |    5.211 (4.878–6.080; n=3/3) |
| Vite + React + Content Collections | warm  | 3.205 (2.961–3.463; n=3/3) |    3.988 (3.746–4.126; n=3/3) |    2.501 (2.361–2.664; n=3/3) |
| Nuxt Content                       | cold  | 0.196 (0.180–0.232; n=3/3) | 15.412 (14.619–15.535; n=3/3) | 15.292 (14.888–15.506; n=3/3) |
| Nuxt Content                       | warm  | 0.157 (0.149–0.176; n=3/3) |    4.770 (4.458–4.772; n=3/3) |    6.497 (6.484–6.742; n=3/3) |
| Void + ContentQuery                | cold  | 8.166 (7.817–9.694; n=3/3) |   9.167 (8.724–10.698; n=3/3) |    8.659 (6.927–8.936; n=3/3) |
| Void + ContentQuery                | warm  | 4.606 (3.272–4.861; n=3/3) |    5.539 (4.095–5.831; n=3/3) |    4.417 (4.011–4.688; n=3/3) |

Before optimization, Void's median usable startup was 31.614/10.834 seconds and its builds took 58.353/59.491 seconds (cold/warm). The changes eliminate duplicate client-side content preparation, reuse Markdown parser rules and unchanged artifacts, exclude generated artifacts from the development watcher, and pack production payload sources. The production server graph shrank from 10,100 to 288 modules, with all 10,000 entries still processed.

The optional in-memory backend measured 6.099/3.728 seconds for startup and 4.512/3.357 seconds for builds in a separate single cold/warm pair. It skips standalone runtime artifact publication and is not the backend used in the comparison table. [Raw in-memory samples](./profile-in-memory.json).

## Method

- Three cold/warm pairs per phase. The original comparison ran apps sequentially, rotating their order between repetitions. The optimized follow-up ran only Void, with the same cache cleanup and content checks. No Vite task-result cache is used.
- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.
- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability includes navigation and verification of the actual collection count, all displayed titles, final title, rendered heading, marker, list, emphasis, and link.
- Build timing ends at successful command completion, including content processing and bundling. Each output is then served and checked in a fresh browser context outside the build timer. Output validation failures exclude that sample from summaries.
- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.
- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.
- Results compare complete application stacks and their normal outputs under this workspace's Vite+ dependency overrides; they do not isolate the content libraries or compare generation of 10,000 HTML pages.

## Environment

- Node: v24.21.0; Chromium: 156.0.8078.4.
- System: darwin arm64, OS 25.3.0.
- CPU: Apple M5; 10 logical CPUs; 24.0 GiB RAM.
- Original run Git revision: `d594e7fc91424f2b481bbfd386985ee0c3358fed`; uncommitted changes: true. The optimized follow-up includes the local ContentQuery changes described in the profiling report; its measured package is identified by the fingerprint below.
- Lockfile SHA-256: `b90d85129234e2432256377d17a7c5a4441d9d6419158699568bdb0986050a99`.
- Original built ContentQuery JavaScript SHA-256: `0e505e735032bc98929598b328efc835f2256347b51b6169bf0631d221e5e63f`; unchanged during the original run: true.
- Optimized built ContentQuery JavaScript SHA-256: `394ac9681bdd845a4b48771c53922ccc3ab2e3ad8a4550aa4d9a0813be7ce15c`.

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

| Stack                              | Resolved packages                                                                                                                                                           | Normal output                                   | Command               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------- |
| Astro collections                  | astro@7.4.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                                                           | Static HTML                                     | `vp exec astro build` |
| Vite + React + Content Collections | react@19.2.5, @content-collections/core@0.15.3, @content-collections/vite@0.3.1, @content-collections/markdown@0.1.4, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16 | Client SPA (all compiled entries in the bundle) | `vp build`            |
| Nuxt Content                       | nuxt@4.6.2, vue@3.5.44, @nuxt/content@3.16.2, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@1.3.0                                                                          | Nitro SSR server + content SQLite               | `vp exec nuxt build`  |
| Void + ContentQuery                | void@1.1.12, @void/react@1.1.12, react@19.2.5, content-query@0.0.0, vite-plus@0.1.16, @voidzero-dev/vite-plus-core@0.1.16                                                   | Static HTML + content artifacts                 | `vp build`            |

## Failures

All samples used in the table succeeded, including browser verification of development and production output. Diagnostic profiling failures and other timing cohorts are documented in [PROFILING.md](../PROFILING.md).

Raw samples: [original four-stack baseline](./single-page.json), [optimized Void follow-up](./profile-final-stable.json). Reproduction: [README](../README.md).
