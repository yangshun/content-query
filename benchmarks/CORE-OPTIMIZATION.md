# ContentQuery core optimization

Optimization resumed in the standalone repository at `~/Developer/content-query`. The target is comparable cold/warm startup and production-build medians to Astro and TanStack Start: the same general range, with no fixed percentage cutoff or requirement to win. The completed comparison below meets that criterion with the saved local Void optimizations. Further optimization is not needed for this target.

The standalone ContentQuery checkpoint is `c9549b0`, retained by the extraction at `c093eab`. The companion Void checkpoint remains on `codex/content-query-performance` at `333e0a89`. The current framework comparison temporarily linked that checkout's built Void and React packages, then restored the published dependency links. The workspace still defaults to published framework packages. This resumed assessment added no production-code changes.

## Resumed standalone comparison

The completed [local-framework comparison](./results/framework-resumed-20261021-RESULTS.md) and [raw data](./results/framework-resumed-20261021.json) measure the standalone workspace at `f89c990` with Void checkpoint `333e0a89`. Three repetitions use seed `2026102137`, chosen before timing solely for balanced application positions. All 36 samples passed browser/content checks and the 80% host-idle gate; all 18 builds verified every one of the 10,001 content HTML pages. The built ContentQuery, Void, and React fingerprints stayed unchanged. Concurrent installs, builds, and tests were stopped before measurement.

Median seconds:

| Stack                                | Cold startup | Warm startup | Cold build | Warm build |
| ------------------------------------ | -----------: | -----------: | ---------: | ---------: |
| Void + ContentQuery, local framework |         3.49 |         2.69 |       5.21 |       6.72 |
| Astro collections                    |         3.28 |         3.17 |       4.22 |       5.76 |
| TanStack Start + ContentQuery        |         2.54 |         2.32 |       5.62 |       7.32 |

All four Void medians are in the same general range as both comparison stacks. Cold startup and builds remain slower than Astro, while warm startup is faster. Builds are faster than TanStack in this run. The goal does not require winning those individual comparisons or meeting a percentage cutoff. The host gate samples load before each measurement and cannot rule out later contention; three samples per median describe this machine and workload.

The separate [published-package baseline](./results/relocated-published-20261021-RESULTS.md) and [raw data](./results/relocated-published-20261021.json) measure the relocated workspace at `c093eab`. It used the same corpus and balanced seed, with all 36 samples settled and passing and all 18 builds validating 10,001 content pages. Its ContentQuery fingerprint matches the local-framework run; only documentation changed between the two recorded repository revisions.

| Stack                                    | Cold startup | Warm startup | Cold build | Warm build |
| ---------------------------------------- | -----------: | -----------: | ---------: | ---------: |
| Void + ContentQuery, published framework |         3.48 |         2.72 |       7.29 |       9.31 |
| Astro collections                        |         3.14 |         2.98 |       4.20 |       5.54 |
| TanStack Start + ContentQuery            |         2.47 |         2.37 |       5.39 |       6.46 |

Published Void builds retain a larger gap. The local-framework results describe the saved optimization branch, not a published release. Differences between these separate runs do not isolate any single optimization.

The [interrupted local-framework run](./results/framework-resumed-interrupted-20261021.json) completed 27 samples before a concurrent installation recreated shared dependencies. It is excluded and was not pooled into either complete comparison. After coordination with the README task, the fresh run completed all 36 measurements. The latest report now contains that completed local-framework comparison.

## Historical application comparison

The pre-extraction [report](./results/framework-followup-20261021-RESULTS.md) and [raw samples](./results/framework-followup-20261021.json) contain three repetitions with seed `2026102103`. The app order is balanced across the repetitions. Only one framework and measurement runs at a time. All 36 samples passed, all 18 builds verified every one of the 10,001 content pages, and every sample met the 80% idle gate. The compiled ContentQuery, Void, and React adapter fingerprints stayed unchanged. Both ContentQuery applications use the optimized package.

Median seconds:

| Stack                         | Cold startup | Warm startup | Cold build | Warm build |
| ----------------------------- | -----------: | -----------: | ---------: | ---------: |
| Void + ContentQuery           |         4.10 |         3.17 |       5.17 |       6.22 |
| Astro collections             |         3.41 |         3.26 |       4.10 |       5.42 |
| TanStack Start + ContentQuery |         2.70 |         2.54 |       5.29 |       7.16 |

The [six-stack baseline](./results/core-baseline-20261020-RESULTS.md) and [raw data](./results/core-baseline-20261020.json) preserve the prerequisite run. Its Void medians were 5.08/4.03 seconds for startup and 8.78/10.63 seconds for builds. The earlier [core-only comparison](./results/core-optimized-20261021-RESULTS.md) is also archived. Framework code and the Void toolchain changed between those runs, so differences between archived runs do not isolate the effect of any single optimization. The host gate measures load before each sample, not throughout it.

The table predates the newer shared watcher, lazy highlighter, and identity transport changes described below. Their separate diagnostic samples must not be pooled into this matched comparison.

Reproduce the focused application comparison from the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter content-query build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench --apps void,tanstack-start,astro --runs 3 --seed 2026102103
```

## Core changes

- Large metadata indexes and payload batches use gzip/base64 when it saves at least ten percent. The existing devalue strings stay intact, preserving dates, BigInts, aliases, missing values, and graph semantics. A portable synchronous decoder initializes metadata without asynchronous module evaluation.
- Vite development uses the same bounded payload batches as production. Compact chunk descriptors replace repeated per-entry dynamic import expressions. Each payload batch is imported and expanded once on demand, and failed loads can retry. Metadata queries still import no bodies.
- Concurrent delivery and startup share serialization of the same development revision. The regression fixture previously serialized twice and now serializes once.
- Glob acquisition keeps at most 64 reads outstanding, preserving deterministic ordering, complete snapshots, cancellation, and grouped diagnostics.
- Single-record queries skip redundant default sorting. Explicit ordering retains sortable-field validation, and filters still run before pagination.
- Initial preparation overlaps later Vite server hooks. Build startup and module loading still await preparation, and closing during initialization waits for and disposes the pending session.
- Sources reuse the session's ready project watcher for ordinary files. Recursive glob directory tracking still covers ignored descendants and missing-directory recovery; external sources keep dedicated watchers.
- Portable runtime dependencies are bundled into the package's ESM output. Shiki and its JavaScript regex engine load only when rendering the first fenced code block. Plain Markdown does not import the highlighter.
- Base64 decoding copies bytes with a loop instead of a callback per byte. An isolated decoder comparison improved from 111 to 88 milliseconds; this is not an application startup measurement.

The [API reference](../docs/API.md), [feature list](../docs/FEATURES.md), [comparison notes](../docs/COMPARISONS.md), and [Vite guide](../website/content/guides/integrations/vite.md) describe the behavior. Standalone generated output retains individual payload modules.

## Attribution

The [before](./results/profile-core-before-attribution.json), [after](./results/profile-core-after-attribution.json), and [summary](./results/profile-core-attribution-summary.json) record instrumented diagnostics. Elapsed preparation spans and inclusive sampled CPU time measure different quantities and can overlap.

| Cold-build diagnostic                     |      Before |     After |
| ----------------------------------------- | ----------: | --------: |
| Main generated ContentQuery server asset  | 2,334.40 kB | 445.45 kB |
| `Miniflare.serializeConfig()` sampled CPU |   641.50 ms |  89.54 ms |
| Content preparation elapsed time          | 1,043.00 ms | 877.37 ms |
| Source acquisition elapsed time           |   574.73 ms | 431.72 ms |

The final [worker replay](./results/profile-core-final-worker-20261021.json) still made 10,001 HTML requests and 10,001 navigation-data requests, then performed 20,002 synchronous writes and 20,002 directory-creation calls. Its prerender phase took 4.90 seconds; synchronous writes accounted for 1.34 seconds in that replay. The parent profile also sampled about 1.37 seconds removing existing output during the warm build. These costs belong to the framework pipeline.

A further [core-only experiment](./results/profile-markdown-candidate-20261021.json) rendered the complete corpus synchronously when a document had no fenced code. All 10,000 HTML/headings results stayed identical, but median rendering time changed from 135.88 ms to 120.13 ms: a saving of 15.75 ms. The candidate was left out because it does not materially address the multi-second application gap. These measurements exclude source acquisition, serialization, and framework work.

## Existing Void renderer change

Local Void main contains commit `6f78ab60`, `perf(prerender): reuse each page's HTML render for its navigation data (#501)`. The installed Void 1.1.12 renderer in the measured comparison still requests both variants.

An isolated [renderer replay](./results/profile-void-main-renderer-20261021.json) used that existing source against the same compiled application. It records the renderer source SHA-256. HTML requests stayed at 10,001; navigation-data requests fell to zero. Prerendering took 3.70 seconds in that diagnostic, compared with 4.90 seconds in the ordinary replay. Both audited all 10,001 pages.

All 20,002 HTML and navigation JSON files were byte-identical across the two replays. Their combined ordered SHA-256 is `91b7aee3874bda006183cc15a6317fbee20db80532a680a5d9f2d7e242e76d82`; [parity evidence](./results/profile-core-renderer-parity.json) records the file counts and bytes.

This replay measures the prerender phase. The application comparison above continues to identify the installed framework and the optimized ContentQuery package that actually ran.

## Authorized Void follow-up

The follow-up scope includes Void's build and prerender pipeline. The local Void package is linked into the benchmark app for these experiments. New comparisons record its built JavaScript fingerprint and source revision as well as the ContentQuery fingerprint; the runner rejects a changed package during measurement. Profiling also records the host idle state before each sample.

The retained changes share directory creation, publish page files with bounded asynchronous writes, and move the default static client output aside before deleting the previous build in parallel with bundle output. Existing output-policy overrides, custom directories, symbolic links, and Git metadata keep Vite's normal cleanup behavior. The completed comparison above includes these changes and the current renderer's reuse of embedded navigation data.

The React adapter also interleaves the document's text shell with React's existing render stream directly, removing two wrapper streams per page. Backpressure, cancellation, deferred shells, and hydration data remain covered. An [isolated renderer check](./results/profile-react-shell-20261021.json) produced identical HTML for all 10,000 representative pages in every sample. Separate and interleaved trials had variable timings on the busy host; they do not establish an application speedup. The experimental app links both Void packages and uses Vite+ 1.3, matching the local framework's toolchain. New reports identify the adapter's compiled code separately.

The output changes passed 38 focused tests and workspace typechecking, followed by 30 native/Node integration tests (three environment-dependent cases skipped). The React stream changes passed nine focused tests. All six benchmark stacks passed development and production checks in the harness; a harness regression also verifies relocated toolchain shims. Final framework verification is recorded below.

An [uninstrumented writer comparison](./results/profile-renderer-output-comparison-20261021.json) verified all 20,002 HTML and navigation files with the same ordered SHA-256 as the earlier parity check. Both completed samples missed the idle gate (53–54% idle), so their timings are diagnostic. The remaining repetitions were stopped. An experimental full build also verified all 10,001 pages at 48% host idle; it is not a controlled comparison and its remaining warm trial was stopped.

A four-page Worker batching candidate was removed after an actual Workerd check found a compression regression: an automatically compressed response rendered correctly through ordinary fetch but failed in the batch transport. Workerd applies its [automatic response compression](https://developers.cloudflare.com/workers/runtime-apis/response/#the-encodebody-option) when transmitting a response, which differs from reading that response inside another handler. The retained implementation keeps ordinary Worker requests.

The newer [identity transport experiment](./results/profile-identity-transport-20261021.json) keeps those ordinary requests and adds `Accept-Encoding: identity` for local prerendering. Three interleaved samples per variant reduced the prerender median from 2.957 to 2.622 seconds (11.3%). All samples passed the host gate. All 20,002 HTML and navigation files were byte-identical, with ordered SHA-256 `eb57998dfc165638da2cf7a5e1045d8bb11563821d3d7b8620587f7dcef5a69e`. This excludes bundling, Worker startup, and path collection; it is not a complete build measurement. Actual Workerd tests cover plain, automatically gzip-encoded, and manually gzip-encoded responses.

An [interleaved concurrency experiment](./results/profile-concurrency-timings-20261021.json) found that 16 render workers were slower than four: median 2.922 versus 2.756 seconds, with identical output. Concurrency stays at four. A [lazy Worker entry experiment](./results/profile-lazy-worker-entry-20261021.json) changed cold/warm startup medians from 3.172/2.683 to 3.123/2.642 seconds. That small difference mostly moved work from server startup into the first request; the entry change was not retained.

The [React environment experiment](./results/profile-react-env-deps-20261021.json) scopes client and Worker dependencies separately and removes forced optimization in the unused Node SSR environment. Three interleaved cold/warm pairs per variant passed the host and browser checks. Startup medians changed from 3.362/2.781 to 3.047/2.693 seconds; all samples, including a 4.951-second cold control, remain recorded. This change is retained in the companion Void branch. It is included in the resumed local-framework comparison; the historical comparison predates it.

The [benchmark README](./README.md#profile-void-and-content-query) documents ordinary and replacement-renderer replays. Full logs and CPU profiles remain under the ignored `.runs/profiles/` directory.

## Verification

The pre-extraction package coverage run passed all 405 tests in 43 files: 92.83% statements, 92.89% lines, 88.70% branches, and 94.65% functions, exceeding its thresholds. Tests cover compact and incompressible content through actual emitted ESM, rich metadata, Unicode and NUL text, heading aliases, detached results, prototype-like IDs, lazy shared imports, retry behavior, isolated development updates, read concurrency, query parity, initial preparation lifecycle, shared watcher subscriptions, and ignored descendants. A fresh Node process verifies that plain Markdown imports no Shiki modules. Native Worker and Chromium checks verify deferred fenced Markdown in development and production.

An earlier complete workspace run passed all 820 tests with four workers. After integration above main's query API update, the complete workspace run passed all 890 tests in 83 files with four workers, and `vp check` passed formatting for 676 files and lint/type checks for 406 files. The new regression verifies relationship-filter scope after ID narrowing in both development and encoded runtimes. The lockfile was reconciled through Vite+ and passed a frozen offline install. Two existing five-second integration checks timed out under higher parallelism and passed in isolation; both also passed in the complete runs. The report regression ensures an unrequested framework is omitted instead of being labeled failed or pending. The development-serialization regression checks each immutable revision separately, allowing legitimate filesystem-triggered replacement revisions.

The resumed standalone ContentQuery suite passed all 618 tests in 64 files. The final `vp run --no-cache check` passed formatting for 488 files and lint/type checks for 287 files. All 73 relative links in the updated benchmark documents resolve. Void's final full-suite run passed 14,038 tests with 31 skipped and one dashboard hydration failure. That dashboard test served a stale prebuilt client; rebuilding the local admin bundle resolved it, and all 123 tests in that file then passed. No source changes were required. Workspace typechecking passed all 33 projects. The full suite was not repeated after the isolated rebuild and rerun.

The checkpoint's latest transport and React optimizer changes passed 37 unit tests, ten native Worker development checks, five Node development checks, and typechecking across all 33 projects. Void's commit hooks also passed formatting and linting. The final complete-suite results above supersede the earlier pending status.
