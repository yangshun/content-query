# Full-site build profile

The corrected workload builds one index and 10,000 dedicated articles. Void's remaining build cost comes from its worker-based prerender pipeline, repeated runtime queries, and larger native output. Markdown compilation is a small part of the total.

The ContentQuery ID-query bottleneck is fixed in `src/runtime/execute.ts`, and plain query and render results are now detached without a serialization round trip in `src/shared/values.ts`. Void and its installed dependencies are unchanged.

## ContentQuery bottleneck and fix

Each article loader calls `.where((fields) => eq(fields.id, id)).select(...).first()`. The executor previously filtered the whole collection before returning the first match. Void requests both HTML and navigation JSON, so 10,000 articles caused 20,000 ID queries and **200 million candidate-record checks**.

The worker CPU profile attributed **44.36% of sampled active worker time** to `executeQuery()`, including **41.35%** in `pageRecords()`. This work happens inside workerd and is absent from the parent Node process's CPU profile.

ContentQuery now builds an ID map once per immutable collection's record array and narrows equality-constrained root queries before the existing filter, sort, pagination, and projection steps. Both query APIs and both runtime backends use the optimization. Additional predicates and independent adjacency scopes still run normally. OR/NOT expressions are not treated as equality constraints. A replacement revision gets a separate index, and the weak cache does not keep discarded revisions alive.

| Worker diagnostic                               |      Before | After ID index |
| ----------------------------------------------- | ----------: | -------------: |
| Article ID queries                              |      20,000 |         20,000 |
| Candidates checked by those queries             | 200,000,000 |         20,000 |
| Candidates across all row queries               | 200,030,000 |         50,000 |
| `executeQuery()` share of active worker samples |      44.36% |          4.32% |
| Prerendered content HTML pages                  |      10,001 |         10,001 |
| Navigation JSON files                           |      10,001 |         10,001 |

The index itself visits 10,000 records once; that setup is additional to the post-index candidate counts. A regression test measured 50,100 ID reads for 50 lookups before the fix, then passed with indexed lookups. Coverage also checks additional filters, missing IDs, counts before pagination, detached projections, prototype-like IDs, OR/NOT behavior, and replacement revisions. Existing fluent/object parity tests cover encoded and in-memory consumers, relationships, and independent adjacency.

All **20,002 HTML and navigation JSON files are byte-identical** before and after the fix. Their combined ordered SHA-256 is `7f09175ababef12150e59dc86c57a3b8a489827a2172a06f6881812e220504aa`.

Evidence: [worker before](./results/profile-full-site-prerender-before-cpu.json), [worker after](./results/profile-full-site-prerender-id-index.json), [output parity](./results/profile-full-site-output-parity.json).

## Result detachment

Query and `render()` results are detached so callers can mutate them without changing stored content. Detachment previously encoded every result with devalue and parsed it back. Rendered HTML contains characters that the encoder escapes, so each article's HTML was scanned character by character, and each index request detached 10,000 selections. Void runs every loader twice per page.

ContentQuery now copies graphs of primitives, plain objects, dense arrays, and dates directly. Each object first passes the same tag, thenable, symbol-key, and `__proto__` checks that the encoder applies. Any other value sends the whole graph through the original round trip, so rich values, repeated references, cycles, and rejection messages are unchanged. In isolation, a three-field selection took 0.08 µs instead of 1.03 µs, and a render result with 11.9 KB of HTML took 0.31 µs instead of 50.4 µs.

| Worker diagnostic                            |        Baseline |    Direct copy |         Repeat |
| -------------------------------------------- | --------------: | -------------: | -------------: |
| `detach()` share of active worker samples    | 11.38% (753 ms) | 1.29% (103 ms) |  1.82% (97 ms) |
| Query `run()` share of active worker samples | 13.97% (925 ms) | 2.68% (213 ms) | 4.65% (249 ms) |
| devalue `stringify()` share                  |  5.85% (387 ms) |    not sampled |    not sampled |
| Active worker time                           |        6,618 ms |       7,954 ms |       5,355 ms |
| Prerendered content HTML pages               |          10,001 |         10,001 |         10,001 |

Each column replays a fresh Void build of the same corpus. The workstation carried other load (load average about 5 during the repeat). The first direct-copy replay ran slower overall even as its ContentQuery frames shrank, so total worker time is not a reliable speedup measure here. The detachment attribution agrees across both direct-copy replays. All **20,002 HTML and navigation JSON files are byte-identical** across the three replays, with combined ordered SHA-256 `ba02b4a635dc61888fffc195b1046833aa5f26085a991fa4bbcf0b1399fabeb1`.

Evidence: [baseline](./results/profile-detach-baseline-20261020.json), [direct copy](./results/profile-detach-fast-path-20261020.json), [repeat](./results/profile-detach-fast-path-repeat-20261020.json), [function attribution and output parity](./results/profile-detach-attribution.json). The replay summaries list only their top 25 frames, so the attribution record carries the per-function values computed from the raw worker profiles.

## Remaining costs, left unchanged

The installed Void renderer runs at concurrency four. For every route it fetches HTML from Miniflare, writes the HTML synchronously, fetches the route again for navigation JSON, then writes that synchronously. The replay recorded **10,001 HTML requests, 10,001 JSON requests, 20,002 synchronous file writes, and 20,002 directory-creation calls**.

| Cost                                    | Observed evidence                                                                                        | Owner                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Two worker requests per route           | 20,002 fetches, stream handling, loader execution, and serialization                                     | Void prerendering                       |
| Static output publication               | 20,002 synchronous file writes; 1.51–1.65 seconds of sampled parent-process time in the initial CPU pair | Void prerendering                       |
| Worker startup and config serialization | Miniflare `serializeConfig()` occupied 1.26–1.68 seconds of sampled parent-process time                  | Miniflare / Void worker setup           |
| Existing-output removal                 | Warm build spent about 1.60 seconds of sampled parent-process time in synchronous removal                | Framework output cleanup                |
| Content preparation                     | One session, 1.38–2.43 seconds elapsed, including source loading, validation, and rendering              | ContentQuery, inside server compilation |
| Markdown rendering                      | 10,000 renders totaled 0.19–0.38 seconds inside preparation                                              | ContentQuery                            |

Result detachment accounted for 11.52% of sampled active worker time after the ID-index fix. After [direct copies](#result-detachment), it accounts for 1.29–1.82% while preserving rich values, aliases, and detached mutable graphs.

These are different measures, and some overlap. Preparation is inside server compilation, and inclusive CPU frames overlap their children; do not add the rows into a wall-clock total.

The production server graph is already bounded: **291 transformed modules**, **199 server asset JavaScript files**, and **189 payload batches**, rather than one bundler entry per article. Client compilation transformed 27 modules. The earlier single-page module-explosion fix remains effective.

Potential Void follow-ups are reusing the page data already embedded in SSR HTML for the JSON artifact and reducing per-file synchronous filesystem work. Both were diagnosed only. Miniflare's linear-growing config serializer remains an upstream candidate, documented in the [historical profile](./PROFILING.md#an-additional-miniflare-optimization). None of these changes were applied.

Sources: [parent-process attribution](./results/profile-full-site-build-attribution.json), [instrumented full-build samples](./results/profile-full-site-build-cpu.json), and the worker diagnostics above. Large CPU profiles and native logs are generated under `.runs/profiles/` and can be discarded after analysis.

## Why Astro has less work

Astro's benchmark passes the actual entry through `getStaticPaths()` props and renders it directly. It does not issue these collection-wide detail queries or prerender through a Cloudflare worker HTTP bridge. Its output is static HTML without the React hydration data used by Void.

| Native content output  |      Astro |       Void |
| ---------------------- | ---------: | ---------: |
| HTML pages             |     10,001 |     10,001 |
| HTML bytes             | 18,260,636 | 35,050,869 |
| Navigation JSON files  |          0 |     10,001 |
| Navigation JSON bytes  |          0 | 14,920,266 |
| Combined content bytes | 18,260,636 | 49,971,135 |

Void writes about **2.74 times as many content bytes**, because the rendered article is present in the DOM, embedded hydration data, and the navigation JSON. These counts exclude JavaScript, CSS, source maps, and other framework assets. The native Astro log for the first cold build reports 1.82 seconds collecting build information, 2.78 seconds generating static routes, and 4.97 seconds total inside Astro; command-launch timing was 5.56 seconds. The first Void CPU build logged 1.90 seconds for server compilation and 66 ms for the client, while the entire instrumented command took 16.31 seconds. Most of that remaining gap is outside bundling.

## Whole-build timings after the ContentQuery fix

Three uninstrumented cold/warm pairs, with the same full-site verification:

| Build | Median seconds |         Range | Successful samples |
| ----- | -------------: | ------------: | -----------------: |
| Cold  |         18.272 | 15.240–28.567 |                3/3 |
| Warm  |         17.953 | 17.427–28.492 |                3/3 |

These samples do **not** establish a reliable whole-build speedup against the earlier 17.551/18.671-second medians. System load and filesystem time varied. The worker replays are instrumented diagnostics, not full-build benchmarks: their prerender phases measured 41.57 seconds before and 12.30 seconds after, with different filesystem costs. The deterministic work reduction and CPU attribution establish the fixed bottleneck independently of those wall-clock differences.

All six builds audited every article HTML file and passed production browser verification. Raw follow-up timings: [profile-full-site-id-index.json](./results/profile-full-site-id-index.json). The [archived composite comparison](./results/composite-20261020-RESULTS.md) retains its original source runs; the current [cross-stack comparison](./RESULTS.md) measures all six stacks in one controlled run.

## Reproduction and validation

Use Node 24.21.0, the pinned dependencies, and the existing 10,000-entry corpus. Build ContentQuery first; preparation is excluded from application timings. Profiling does not replace `RESULTS.md` or other stacks' measurements.

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter content-query build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode cpu --backend in-memory --label build-cpu --phase build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile:summary .runs/profiles/build-cpu results/profile-build-attribution.json
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode timings --backend in-memory --label build-timings --phase build --runs 3
vp env exec --node 24.21.0 -- vp exec node content-query/benchmarks/scripts/profile-prerender.mjs --label worker-build
```

The last command requires a completed Void build; the detachment comparison ran `vp build` in `apps/void` after each package build. It replays the installed renderer against that built worker into a fresh ignored output directory. A Node load hook exposes the runner and enables its local inspector; a counter is added to the worker's ContentQuery query function in memory. Neither Void's source nor installed files are edited. It records worker CPU attribution, query candidates, filesystem calls, phase timings, and an audit of all 10,001 content HTML pages. Use a new label for every replay.

The ContentQuery package suite passed **345 tests in 37 files**. V8 coverage passed its configured thresholds: **92.41% statements, 87.69% branches, 94.44% functions, and 92.49% lines**. Consumer-guide integration and profiler-summary tests passed another 33 tests. `vp check` passed formatting, lint, and TypeScript checks across the workspace.

After the detachment change, the package suite passed **361 tests in 37 files** with **92.47% statements, 87.78% branches, 94.29% functions, and 92.48% lines**, and `vp check` passed.
