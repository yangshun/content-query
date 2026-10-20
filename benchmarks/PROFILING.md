# Void + ContentQuery startup and build profile

This report covers the historical single-page workload. The benchmark apps now list every item and prerender a dedicated article page for every entry. These timings do not measure the corrected full-site workload. See [the benchmark README](./README.md) for the current commands.

The largest build cost was preparing a Cloudflare worker containing 10,000 separately imported payload modules. Miniflare serialized that worker through a Cap'n Proto arena that repeatedly copied its existing buffer. ContentQuery also prepared the corpus again for the client build, rebuilt the Markdown parser for each article, and staged unchanged artifact files. During cold development startup, Vite's watcher processed the generated-file traffic.

The implemented changes reduce the production source graph from **10,100 to 288 modules**, payload output files from **10,000 to 189**, and server asset JavaScript files from **10,006 to 195**. All 10,000 entries are still processed. The index, first 20 titles, final title, and first rendered article pass the same browser checks.

## Observed timings

Seconds, median (minimum–maximum), three cold/warm pairs per phase. These are uninstrumented process-launch timings, including content preparation. Startup ends at browser-verified usable content; production preview validation is outside the build timer.

| Measurement   | Original implementation | Latest optimized repeat |
| ------------- | ----------------------- | ----------------------- |
| Startup, cold | 31.614 (29.747–32.047)  | 9.167 (8.724–10.698)    |
| Startup, warm | 10.834 (9.646–11.244)   | 5.539 (4.095–5.831)     |
| Build, cold   | 58.353 (51.650–60.901)  | 8.659 (6.927–8.936)     |
| Build, warm   | 59.491 (55.843–59.794)  | 4.417 (4.011–4.688)     |

Sources: [archived original comparison](./results/single-page.json), [latest three-pair repeat](./results/profile-final-stable.json). The [archived single-page report](./results/single-page-RESULTS.md) combines the optimized Void follow-up with the original measurements for the other three stacks and identifies both run dates. The current [RESULTS.md](./RESULTS.md) uses the full-site workload.

System load varied substantially during this investigation. An earlier three-pair run of the same optimized package measured 32.920/19.217 seconds for cold/warm startup and 29.325/17.076 seconds for builds: [earlier optimized samples](./results/profile-final.json). A fresh original-package pair measured 197.081/11.008 seconds for startup and 64.641/56.353 seconds for builds: [fresh baseline](./results/profile-baseline-loaded.json). An immediate optimized recheck measured 11.038/5.750 seconds and 7.962/5.289 seconds: [confirmation](./results/profile-final-confirmation.json).

All runs are retained. The latest repeat estimates the observed improvement; these were separate sessions on a busy workstation, not a controlled idle A/B experiment. The source/module counts, duplicate preparation, filesystem operation counts, and serializer behavior establish the bottlenecks independently of those wall-clock differences.

## What changed

Normalized evidence: [original CPU and phase attribution](./results/profile-baseline-attribution.json), [intermediate startup/watcher attribution](./results/profile-intermediate-attribution.json), and [final build attribution and module counts](./results/profile-final-attribution.json). The final cold build trace records one preparation session and 10,000 Markdown renders, with approximately 0.26 seconds inside rendering and 0.86 seconds of sampled inclusive serializer time.

### Pack payload sources before bundling

The original collection index contained one literal dynamic import per article. Void's strict entry signatures preserved one worker module for each payload. Grouping output chunks alone still left 10,000 small facade modules alongside the grouped data; the [intermediate measurements](./results/profile-optimized.json) and [intermediate CPU profiles](./results/profile-optimized-cpu.json) retain that experiment.

[Source generation](../packages/content-query/src/artifacts/modules.ts) now packs production Vite payloads into lazy source modules targeting 128 KiB before the bundler sees them. This reduces actual entry points even with strict signatures. [The Vite plugin](../packages/content-query/src/integrations/vite/plugin.ts) supplies these portable modules for virtual and physical server-entry imports, with either backend. It also avoids preparing unused development delivery modules during production.

Default metadata queries still import no payload modules. Reading or rendering an article can load neighboring encoded payloads from the same batch. Host output settings remain effective. Development and standalone generated artifacts retain their individual immutable payload modules.

### Prepare server content once

The original build profile recorded **two sessions, 20,000 source reads, and 20,000 Markdown renders**. ContentQuery's `buildStart` ran during worker compilation and again during client compilation. Production client graphs now skip preparation while retaining the server import guards. The complete corpus is prepared once for the server graph.

### Reuse Markdown parser rules

[Markdown rendering](../packages/content-query/src/runtime/markdown.ts) previously constructed `MarkdownExit`, including Linkify's compiled rules, for every article. The original build profile attributed about 13.3 seconds of sampled inclusive time to Linkify compilation. The parser and fence rule are now reused; tokens, reference environments, heading sluggers, and result arrays remain local to each render.

Tests cover simultaneous documents with repeated headings and distinct reference links, syntax highlighting, and unknown fenced languages. Eager production rendering remains the default.

### Stop generated-file watcher traffic and redundant writes

The original cold-start CPU profile spent approximately **69% of non-idle main-isolate samples** inside Vite's directory walker. Publishing the corpus generated thousands of file events while the server was still starting.

The Vite watcher now excludes the generated output directory while preserving user ignores and authored-source watching. A follow-up startup trace recorded **zero watched artifact directories and zero artifact events**.

[Artifact publication](../packages/content-query/src/artifacts/write.ts) now verifies and reuses existing immutable bytes before staging writes, creates output directories once, and uses at most 16 concurrent writers. Every writer settles before the public server entry switches. Corrupt immutable files still reject publication, and older revisions retain their files. The follow-up warm trace recorded **zero artifact writes, links, and temporary-file removals**.

## An additional Miniflare optimization

The original build CPU profile attributed approximately **52% of non-idle main-isolate samples** to Miniflare's config serializer. In Miniflare `5.20261012.0-beta`, bundled `capnp-es` `0.0.16` uses a single-segment arena that allocates `oldSize + growth` and copies the entire old buffer on each expansion.

[The isolated serializer experiment](./scripts/profile-serializer.mjs) compares that allocator with geometric growth. It times only serialization of synthetic workerd configs containing distinct JavaScript modules with approximately 1 KiB of source each.

| Modules | Installed linear growth | Geometric growth |
| ------- | ----------------------- | ---------------- |
| 100     | 6.63 ms                 | 6.63 ms          |
| 1,000   | 75.20 ms                | 24.05 ms         |
| 10,000  | 6,079.78 ms             | 136.34 ms        |

The 10,000-module case was approximately **45× faster**, and the child process's peak RSS fell from approximately **1.05 GiB to 276 MiB**. Serialized lengths and SHA-256 hashes match for every case. [Raw serializer results](./results/profile-serializer.json).

The candidate change is:

```diff
-new ArrayBuffer(srcBuffer.byteLength + minSize)
+new ArrayBuffer(Math.max(srcBuffer.byteLength * 2, srcBuffer.byteLength + minSize))
```

This is an upstream optimization candidate. The experiment applies the substitution through an isolated child's load hook; installed dependency files and the application benchmarks use the original allocator. Broader upstream tests would need to cover arena limits and other message shapes. The synthetic speedup is not an application build speedup.

## Existing in-memory backend

A Vite application can avoid standalone artifact publication with its existing configuration option:

```ts
contentQuery({ backend: "in-memory" });
```

A separate single cold/warm pair measured startup at **6.099/3.728 seconds** and builds at **4.512/3.357 seconds**, with all browser checks passing: [raw in-memory results](./results/profile-in-memory.json). This mode emits Vite declarations and the normal bundled application output. The historical comparison used the generated backend, which additionally publishes standalone runtime artifacts; the current Vite benchmarks default to in-memory storage.

## Environment and reproduction

- Apple M5, 10 logical CPUs, 24 GiB RAM, Darwin arm64 25.3.0.
- Node 24.21.0; `vite-plus` 0.1.16 / Vite 8.0.5; Void and `@void/react` 1.1.12; React 19.2.5.
- Miniflare 5.20261012.0-beta, bundled capnp-es 0.0.16.
- 10,000 Markdown files, 10,248,894 source bytes. Corpus SHA-256: `591f5510c25529afdf3e999f7586c3d30a39120239131572460c7208fd8f19f4`.
- Original ContentQuery runtime fingerprint: `0e505e735032bc98929598b328efc835f2256347b51b6169bf0631d221e5e63f`.
- Optimized runtime fingerprint: `394ac9681bdd845a4b48771c53922ccc3ab2e3ad8a4550aa4d9a0813be7ce15c`.
- Lockfile SHA-256 remained `b90d85129234e2432256377d17a7c5a4441d9d6419158699568bdb0986050a99` across the compared runs.

Follow [setup](./README.md#setup), then run from the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode timings --label local --runs 3
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode cpu --label local-cpu --phase build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile:summary .runs/profiles/local-cpu results/profile-attribution.json
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile --mode timings --label local-memory --backend in-memory
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks profile:serializer
```

Timing uses the suite's monotonic timers, sequential cold/warm pairs, prelaunched browser and fresh contexts, application-cache cleanup, OS filesystem-cache retention, five-minute startup deadline, ten-minute build deadline, and process-group cleanup. Corpus generation and package compilation remain outside timing. The profiler checks that package artifacts remain unchanged during a run.

CPU profiles cover the main Node isolate. Instrumented spans overlap, and summed asynchronous I/O latencies are not elapsed time. Initial CPU-profiled builds completed, but two preview checks hit the previous 30-second navigation cap; those diagnostic failures remain recorded. Navigation now honors the full five-minute startup deadline. All final uninstrumented samples passed browser verification.

Large CPU profiles and complete logs are generated in ignored `.runs/` directories and can be discarded after analysis. Normalized attribution and raw timing JSON preserve the evidence without checking in those large files. The [profiler commands](./README.md#profile-void-and-content-query) describe trace-only collection and output paths.

## Validation

Regression coverage includes unchanged-file timestamps and write counts, failed atomic publication, generated-output watcher exclusions, custom output paths, client-only builds, strict entry signatures, generated and in-memory backends, bounded payload sources, special entry IDs, bundled reads after configuration removal, concurrent rendering, and CPU/log attribution calculations. The existing native app smoke tests continue to verify all four stacks in development and production using isolated small corpora.

`vp check` passed, and the full workspace test run passed 726 tests across 72 files. Package V8 coverage reports 92.00% statements, 87.23% branches, 93.93% functions, and 92.07% lines, exceeding the configured thresholds.
