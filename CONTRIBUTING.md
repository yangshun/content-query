# Contributing to ContentQuery

## Setup and checks

From this repository root, use Node.js 24.21.0 and Vite+. The repository owns its workspace configuration, dependency catalog, lockfile, formatting, type-aware linting, TypeScript checks, tests, and package builds:

```sh
vp install --frozen-lockfile
vp run build
vp run check
vp test run
vp test run --coverage
```

`vp run check` builds the library and prepares consumer declarations and framework types before running workspace formatting, linting, and TypeScript checks. Preparation includes SvelteKit diagnostics. Use the built-in `vp check` directly after preparation. Run `vp fmt` to format workspace files or `vp lint` for linting alone.

Installation builds the library so local CLI links work immediately, and the integration suite rebuilds it before exercising consumers. The pre-commit hook runs `vp staged`. GitHub Actions builds the library, checks the workspace, and runs tests with coverage, including framework examples, the website, and benchmark unit tests. Browser tests for benchmark apps are opt-in through `vp test run --config benchmarks/vite.browser.config.ts`; see the [benchmark setup](./benchmarks/README.md) for Chromium installation. Performance measurements remain manual. Package coverage must remain above 90% for statements, lines, and functions, and 85% for branches. Cloudflare Workers Builds handles the website build and deployment separately.

## Development

Use `vp run dev` to watch the library build. In another terminal, run `vp run --filter @content-query/website dev` or an example's development command. `vp run build:website` builds the library before the website; `vp run build:examples` builds the library before all examples. Each [example](./examples/README.md) documents its own commands. Examples keep local styles and helpers so they can be copied independently; common copies live in `examples/shared/`.

## Repository layout

```text
content-query/
  packages/
    content-query/  Library source, tests, and package README
  examples/
    angular/
    void/
    next/
    react-router/
    tanstack-start/
    sveltekit/
    shared/        Common source files and example parity tests
  benchmarks/      Six stacks with 10,000 shared entries and timing reports
  docs/            API, design, features, comparisons, and planned work
  website/         Void + React homepage and documentation site
  README.md
```

## Source layout

The following paths are relative to `packages/content-query/`.

Top-level `src/` files preserve the package entry points. Implementations live with the subsystem that owns them:

```text
src/
  collection/     Collection definitions, schema inference, registry checks
  schema/         Bundled content builders and Standard Schema inference helpers
  query/          Portable query plans, operators, fluent builders, query types
  runtime/        JavaScript execution, projection, relationships, bodies, rendering
  preparation/    Configuration, validation, source updates, sessions, watching
  loaders/        Glob/file acquisition, source descriptors, parsing, loader types
  artifacts/      Artifact format, ESM generation, publication, runtime decoding
  integrations/
    cli/          Command arguments and diagnostic reporting
    vite/         Plugin lifecycle, client boundaries, virtual-module delivery
  shared/         Errors, value semantics, paths, server-only guard
tests/
  integration/    PLAN.md living example, generated consumers, CLI, Vite dev and builds
  fixtures/       Executable end-to-end example
  helpers/        Consumer fixtures and package-build setup
```

Unit tests stay beside their owning modules. Query plans are independent of JavaScript evaluation so another backend can interpret the same contract. Preparation owns source acquisition and validation; production runtime code consumes prepared revisions without importing preparation or host integrations. Artifact generation/writing and runtime decoding use separate modules to preserve that boundary. Session update ordering, cancellation, and atomic publication stay together in `preparation/session.ts`.

## Development checks

From `packages/content-query/`, run `vp check` and `vp test run --coverage`. The suite covers every documented value of the PLAN.md living example (`tests/integration/living-example.test.ts`; update it with the plan), typed consumer callsites, both backends, generated consumers without source files, watch recovery, concurrent publication, CLI behavior, and Vite integration. Coverage requires at least 90% statements/lines, 85% branches, and 90% functions. The repository's `vp test run` also exercises all framework examples, benchmark unit tests, and the website. VoidPress verifies its consumers in its own repository. The root formatter configuration ignores `dist/` and `coverage/` output.

Watch recovery tests repeat configuration notifications and check stable error codes and diagnostics, preserved revisions, and rejected reads through content edits before verifying recovery from a corrected configuration.

The living-example declaration and published Astro-loader consumer checks launch TypeScript and fresh Node processes. They use explicit 30-second deadlines to accommodate compiler startup under coverage or system load; ordinary tests retain the default deadline and all consumer assertions remain enabled.

The packed-package integration tests unpack the actual npm tarball into isolated consumers, verify its exports, license, and documentation links, type-check the Vite integration without Vite+ installed, and query/render generated content after removing authored sources. Vite+ remains the development toolchain; published Vite declarations reference the optional Vite 8 peer. The npm package supports Node.js 22.12 or later, while contributor tooling uses the version in `.node-version`.

The local Vite export uses source types so workspace development shares its existing Vite+ types. Every runtime export still resolves built JavaScript. Vite+ generates `publishConfig` exports for the published declarations; npm tarballs contain only built entry points. This keeps workspace development and ordinary Vite consumers on their respective host types without exposing TypeScript sources to application builds.

To inspect a release tarball after building, run `vp pm pack --filter content-query --out /tmp/content-query.tgz`. Keep the root and package `LICENSE` files identical so both the repository and npm distribution include the MIT license.

Publish approved releases through `vp pm publish --filter content-query --access public` so the package manager applies the generated `publishConfig` entry points. Verify the packed consumer tests, full checks, coverage, and website build before publishing.

## Documentation

Keep the [website](./website/README.md) current when core changes affect public APIs, features, or behavior.

The [API guide](./docs/API.md) documents package usage and behavior. The [documentation index](./docs/README.md) links to feature, comparison, design, and roadmap documents.

For performance investigation, see the [benchmark suite](./benchmarks/README.md), [current results](./benchmarks/RESULTS.md), and [historical startup and build profiling report](./benchmarks/PROFILING.md).

## VoidPress integration

VoidPress checks this repository out as a Git submodule at `content-query/` and keeps `content-query/packages/*` in its workspace. Its `"content-query": "workspace:*"` dependency continues to resolve locally. Develop here or in the submodule checkout, commit ContentQuery changes first, then update VoidPress's submodule pin. The standalone checkout and the submodule are separate working trees; use Git commits to synchronize them. See [repository history](./docs/HISTORY.md) for the extraction boundary and original commit mapping.
