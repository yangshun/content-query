# Content benchmarks

The three ContentQuery apps use the current SQL-ordered `content.select(...fields).from(collection)` and collection-scoped `content.query.entries.findFirst({ columns, where })` APIs. Query fields, filters, ordering, and workload remain the same across the API migration. Recorded timing reports retain their original measurements.

Six applications build a full static site from the same 10,000 Markdown entries using native content integrations:

| App                                               | Content integration                                             | Production output                                 |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| [Astro](./apps/astro/README.md)                   | Built-in content collections and `glob()`                       | 10,001 static content HTML pages                  |
| [Vite + React](./apps/vite-react/README.md)       | `@content-collections/vite` and `@content-collections/markdown` | 10,001 prerendered pages with React hydration     |
| [Nuxt](./apps/nuxt/README.md)                     | `@nuxt/content`, page collection, native Node SQLite            | 10,001 prerendered pages and Nuxt payloads        |
| [Void](./apps/void/README.md)                     | Workspace ContentQuery and its Vite plugin                      | 10,001 prerendered pages and content artifacts    |
| [Next.js](./apps/next/README.md)                  | Workspace ContentQuery and its Next.js adapter                  | 10,001 static content HTML pages and RSC payloads |
| [TanStack Start](./apps/tanstack-start/README.md) | Workspace ContentQuery and its Vite plugin                      | 10,001 prerendered pages with React hydration     |

Every homepage renders the actual collection count and every title and description, ordered by the source metadata, with a link to its dedicated article page. Each article page renders that entry's title, description, and Markdown body. Production builds prerender the homepage and all 10,000 articles. This compares complete application stacks, including their hydration assets and content payloads.

## Setup

Run these commands from the repository root. Use the explicit runtime wrapper because the system's Node version can differ from `.node-version`.

```sh
vp env exec --node 24.21.0 -- vp install --frozen-lockfile
vp env exec --node 24.21.0 -- vp run --no-cache --filter content-query build
vp env exec --node 24.21.0 -- vp exec --filter @content-query/benchmarks playwright install chromium
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks generate
```

The generator creates 10,000 deterministic, unique files of approximately 1 KB each in `.fixtures/entries/`. It hardlinks each file into every app's `content/entries/` folder, with a copy fallback for filesystems that do not support hardlinks. The manifest records the entry count, source bytes, ordered corpus SHA-256, hardlink count, and copy count. These generated directories are ignored by Git; regenerate them after a fresh checkout. The generator replaces only its own generated entry folders. Edit the generator rather than the hardlinked files.

## Run the comparison

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench
```

The runner generates the corpus before starting any timers. It requires the package build and browser setup above. Results are checkpointed after each sample to [results/latest.json](./results/latest.json) and summarized in [RESULTS.md](./RESULTS.md). The current workload is recorded as `full-index-and-prerendered-articles` in raw measurements. The [historical single-page report](./results/single-page-RESULTS.md) and [raw data](./results/single-page.json) describe the previous workload and are not directly comparable. A full benchmark run replaces the latest report with that run's complete comparison. Each run writes complete command output to the ignored `.runs/` directory.

The current report is a focused comparison of Void, Astro, and TanStack Start after the [core optimizations](./CORE-OPTIMIZATION.md). Its cold and warm tables show content-usable startup and production build time to two decimal places. All three stacks use one run with seed `20261021`; both ContentQuery apps use the same optimized package. Unrequested stacks are omitted from focused reports. Only one framework and measurement type runs at a time; each server, build process, and validation preview stops before the next sample. Keep other development servers, builds, tests, and benchmarking agents stopped during measurement.

The [six-stack baseline report](./results/core-baseline-20261020-RESULTS.md) and [raw samples](./results/core-baseline-20261020.json) preserve the 2026-10-20 rerun. It used seed `1506779684`, selected before measurement so every app occupies a different position in each of the three repetitions, with no repeated predecessor/successor pair within those orders. All 72 samples passed, all 36 production builds verified 10,001 content pages each, and every sample began after the host met the 80% idle threshold. Reproduce its order by appending `--seed 1506779684` to the command above.

The focused comparison passed all 36 samples and verified all 10,001 pages from each of its 18 builds. Every sample met the idle threshold, and the package fingerprint remained unchanged. Its [saved report](./results/core-optimized-20261021-RESULTS.md) and [raw measurements](./results/core-optimized-20261021.json) remain separate from the baseline. The requested performance target remains open: the optimized Void stack still trails Astro and TanStack Start in this run.

The previous [composite report](./results/composite-20261020-RESULTS.md) and its [raw comparison](./results/composite-20261020.json) combined three separate runs: the [original five-framework sequential comparison](./results/full-site-sequential-20261020.json), refreshed [Astro samples](./results/astro-rerun-20261020.json), and a [TanStack Start run](./results/tanstack-start-20261020.json). Those sources ran under different host load, and in two of three repetitions Void ran immediately after Next.js, while background indexing of the previous stack's output was still running. Its timings are not directly comparable across stacks. The [earlier comparison](./results/pre-sequential-20261020.json) and [report](./results/pre-sequential-20261020-RESULTS.md) remain archived.

### Measurement controls

- **Each app's own toolchain:** every command runs through the app's `node_modules/.bin/vp`, so each stack uses the Vite+ version it declares, and the versions table records the CLI that actually ran. A bare `vp` would resolve to whichever binary is first on PATH; under `vp run`, that is this benchmark package's pinned `vite-plus`, whose development server does not serve TanStack Start routes.
- **Randomized order:** each repetition measures the apps in an independent random order derived from `--seed`. The seed and every order are recorded, so a run can be reproduced and no stack always follows the same predecessor.
- **Quiet host:** before every sample, the runner waits until host CPU is at least 80% idle, averaged over three consecutive one-second windows, for up to 180 seconds. It records the idle fraction, wait, and load average with each sample, and the report lists samples that started before the host settled. The gate checks only before a sample; it cannot exclude contention that begins during one.
- **Spotlight:** at startup, the runner writes a probe file under `apps/` and records whether Spotlight indexes it. Builds emit 10,000 to 20,000 files, and indexing them competes with the timed process in proportion to each stack's output. On current macOS, `.metadata_never_index` marker files are ignored for ordinary folders; folders ending in `.noindex`, hidden folders, and Spotlight's privacy list are excluded. Before a comparison run, add `content-query/benchmarks/apps` to Spotlight's privacy list or disable indexing with `sudo mdutil -a -i off` (restore it with `sudo mdutil -a -i on`), and quit applications that watch the repository, such as Git clients.

The [previous in-memory samples](./results/full-site-in-memory.json) and [Void rerun after Next.js stopped](./results/profile-void-no-next-20261020.json) remain archived. The [original report](./results/full-site-generated-RESULTS.md) preserves the generated-backend Void measurements. To collect Void-only timings after rebuilding ContentQuery while preserving the comparison report:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter content-query build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode timings --backend in-memory --label void-no-next-20261020 --phase all --runs 3
```

This saves `results/profile-void-no-next-20261020.json` without overwriting other stacks' results. Choose a fresh label for subsequent runs. The archived composite comparison identifies each sample's `sourceRun` and records each source environment in `measurementRuns`. The ordinary `bench --apps void` command replaces `results/latest.json` and `RESULTS.md` at every checkpoint, so use the timing profiler above for partial reruns.

The runner fingerprints the built ContentQuery package before and after every sample and aborts if it changes. Interrupted runs are excluded from the current comparison.

Checked-in artifacts retain the current comparison, its source measurements, historical reports for distinct workloads, and evidence cited by the profiling reports. Duplicate snapshots, unused per-framework reports, and abandoned validation runs are omitted. Fixtures, build output, caches, complete logs, and CPU profiles are generated locally and ignored by Git; the commands below recreate them.

The default run measures three cold/warm pairs for startup and build per app, sequentially, in a seeded random app order per repetition, waiting for a quiet host before each sample. Each cold run removes that app's content artifacts, framework caches, output, and local Vite optimizer cache. Its warm partner retains the preceding run's generated files. The OS filesystem cache is retained; hardlinks can make source reads warm across applications. No Vite task-result cache is used.

Cleanup includes Astro's persistent `node_modules/.astro/` content store and Nuxt's `node_modules/.cache/`, as well as app-root generated directories and Vite's `node_modules/.vite/` optimizer cache. A regression test verifies that these caches are removed while actual dependencies and source content remain intact.

- **Server listening (raw JSON only):** elapsed time from process spawn until a TCP connection succeeds. This diagnostic check does not send HTTP or trigger page compilation. The comparison tables show content-usable startup and production build times to two decimal places; raw timings retain full precision. Recording TCP readiness adds no separate run.
- **Content usable:** elapsed time from the same spawn until a prelaunched Chromium, using a fresh browser context and page, verifies all homepage titles, descriptions, and item links, then directly loads the first and last article pages and verifies their own metadata and rendered heading, body marker, list, emphasis, and link. If a navigation is refused or aborted, for example by Astro's development reload shortly after its client connects, the check restarts from the homepage in a fresh page of the same browser context; the retry counts toward the startup time. Reusing the aborted page could leave Chromium unable to navigate until the deadline.
- **Production build:** elapsed time from build process spawn until successful command completion. It includes content processing, browser/server compilation, route enumeration, and rendering every item page. Outside the timer, validation audits all 10,000 emitted article HTML files, checks that the homepage links them all, and verifies the static output in Chromium. Missing pages, client shells, and incorrect article bodies fail the sample.

All production previews use the shared static-file server in `shared/preview.ts`. It serves directory-style HTML and Void's flat `.html` layout directly, with no SSR renderer or SPA fallback. Preview and artifact-audit time remain outside the build timer.

Dependency installation, ContentQuery package compilation, fixture generation, browser launch/context creation, cache cleanup, and shutdown are excluded. Startup is limited to five minutes and builds to ten minutes. Failures retain their logs and are excluded from timing summaries. Successful sample counts are shown alongside each median and range. Interrupting the runner terminates its child process groups.

The inputs contain no images, code fences, or framework components. Native content processing defaults are retained, with no forced deferred rendering. Astro uses `getStaticPaths()`, Nuxt uses `nuxt generate` and its link crawler, and Void uses `getPrerenderPaths()`. Next.js uses App Router Server Components, `generateStaticParams()`, and `output: "export"` through the native ContentQuery Next.js adapter. Its build includes preparing generated content artifacts and uses Next's default Turbopack bundler. The Vite + React app uses Vite's SSR API and a small build script to render every route after client and server compilation; all these steps are included in its timed `vp run --no-cache build` command. Nuxt uses the native Node SQLite connector to avoid an external native database build. Vite-based stacks inherit the repository's Vite+ dependency overrides; the report captures each installed toolchain and package version.

Useful smaller runs, from the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench --runs 1 --entries 100
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench --apps astro,void --phase build
```

Options are `--entries` (default `10000`), `--runs` (default `3`), `--apps` (comma-separated `astro,vite-react,nuxt,void,next,tanstack-start`), `--phase` (`all`, `startup`, or `build`), `--seed` (an integer from `0` to `4294967295`; defaults to one derived from the current time and recorded in the report), `--settle-idle` (minimum idle CPU fraction before each sample, default `0.8`), and `--settle-timeout` (maximum seconds to wait for it, default `180`; `0` records one measurement window without waiting). Use `--apps next` for only Next.js + ContentQuery or `--apps tanstack-start` for only TanStack Start + ContentQuery. Each run overwrites the latest report, so preserve a report before running a different workload. Run the default command again to restore the full dataset and report after experimenting.

## Profile Void and ContentQuery

The [earlier full-site build profile](./BUILD-PROFILING.md) separates ContentQuery preparation and runtime queries from Void's worker setup, prerender requests, and output writes. It includes the ContentQuery-only ID-query fix, before/after worker CPU attribution, byte-for-byte output parity, and follow-up build timings recorded before Void changes.

The [core optimization report](./CORE-OPTIMIZATION.md) records compact artifacts, bounded source reads, shared development serialization, the focused comparison, and final CPU attribution. A renderer replay can isolate an existing framework change against the same compiled application:

```sh
vp env exec --node 24.21.0 -- vp exec --filter @content-query/benchmarks node scripts/profile-prerender.mjs --label renderer-baseline
vp env exec --node 24.21.0 -- vp exec --filter @content-query/benchmarks node scripts/profile-prerender.mjs --renderer ../../../void/packages/void/src/prerender-render.ts --label renderer-candidate
```

The second command assumes a sibling Void checkout and reads its renderer source. The replay records that source's SHA-256 and substitutes it in its own process. Replay timings cover prerendering; the `bench` command measures complete application builds.

The [Void follow-up](./CORE-OPTIMIZATION.md#authorized-void-follow-up) uses a locally built framework package. The app currently links that sibling checkout; build it before running a comparison. New reports record the exact built Void code, and the runner checks that it stays unchanged. Both `profile` and renderer replays now wait for the usual host idle threshold and record whether it was reached. Timings from a busy host remain diagnostic.

The [historical profiling report](./PROFILING.md) records startup/build bottlenecks and follow-up measurements for the previous single-page workload. The commands below profile the current full-site workload. After building ContentQuery and generating the corpus, collect profiles without replacing the six-stack comparison:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode timings --label local --runs 3
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode trace --label local-trace
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode cpu --label local-cpu --phase build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile:summary .runs/profiles/local-cpu results/profile-attribution.json
```

`timings` uses the ordinary benchmark commands without instrumentation. `trace` adds preparation spans and filesystem operation counters to the built ContentQuery modules through Node load hooks. `cpu` also records V8 CPU profiles. Instrumentation adds overhead: use these modes to attribute work, and compare wall-clock performance using `timings`. Spans can overlap; summed asynchronous I/O durations are not elapsed time. The profiler excludes production preview from instrumentation.

Raw samples are saved to `results/profile-<label>.json`. Logs, per-process span/counter JSON, and `.cpuprofile` files remain in `.runs/profiles/<label>/`; open CPU profiles in the browser's JavaScript profiler. Labels overwrite their own previous files. `--phase` accepts `all`, `startup`, or `build`. Profiles use the existing generated corpus and preserve `results/latest.json` and `RESULTS.md`.

The Void app and profiler default to the in-memory backend, emitting only declarations alongside the normal bundled output. Use `--backend generated` with `profile` to additionally publish standalone runtime artifacts, or set `CONTENT_QUERY_BENCH_BACKEND=generated` when running the Void app or full benchmark suite. The Next.js adapter uses generated artifacts independently of this Vite option. The profiling report records the backend used. Historical measurements retain their original backend and workload.

`profile:serializer` compares Miniflare's installed linear arena growth with geometric growth in isolated Node child processes using synthetic module configs. The load hook changes only the child process's source and checks that every serialized byte matches. It does not modify installed dependency files or the application benchmarks.

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile:serializer
```

## Validation

```sh
vp env exec --node 24.21.0 -- vp test content-query/benchmarks
vp env exec --node 24.21.0 -- vp check
vp env exec --node 24.21.0 -- vp test
```

Unit tests cover corpus determinism, app-file parity, hardlink and copy behavior, invalid inputs, timing summaries, deadlines, and process-tree cleanup. Integration tests copy the real apps into a temporary workspace with 24 entries each, then verify the full index and first/last articles in development and production in Chromium. They audit all 25 content HTML files, including every article body, and exceed the old 20-item display limit. They do not overwrite the main 10,000-entry corpus or timing report. Install Chromium before running them.

Generate framework types before the workspace check if the app-generated directories have been removed: run Astro's `sync` and Nuxt's `prepare` commands in their app folders, and start/build the React and Void apps to generate their collection types. The benchmark builds also generate these files.
