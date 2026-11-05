import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeFsHandler } from "chokidar/handler.js";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../collection/define.ts";
import { file, glob } from "../loaders.ts";
import { createSession, sessionInternals } from "./session.ts";
import { watchDependencies } from "./watch.ts";
import { projectFixture } from "../../tests/helpers/project.ts";
import { bodyOf } from "../../tests/helpers/payloads.ts";
import { loadAll } from "../../tests/helpers/collections.ts";

/** Gives the watcher time to report an event, if it were going to. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

describe("source watching", () => {
  test.each(["glob", "file"] as const)(
    "subscribes once to a %s source already covered by the project watcher",
    async (kind) => {
      const root = await realpath(
        await mkdtemp(path.join(os.tmpdir(), "content-query-shared-watch-")),
      );
      const base = path.join(root, "content");
      const filename = path.join(base, kind === "glob" ? "post.md" : "posts.json");
      await mkdir(base);
      await writeFile(
        filename,
        kind === "glob"
          ? "---\ntitle: Initial\n---\n"
          : JSON.stringify([{ id: "post", title: "Initial" }]),
      );
      // oxlint-disable-next-line typescript-eslint/unbound-method
      const subscribe = NodeFsHandler.prototype._watchWithNodeFs;
      let sourceSubscriptions = 0;
      const subscriptions = vi
        .spyOn(NodeFsHandler.prototype, "_watchWithNodeFs")
        .mockImplementation(function (
          this: NodeFsHandler,
          ...arguments_: Parameters<typeof subscribe>
        ) {
          if (path.resolve(arguments_[0]) === filename) {
            sourceSubscriptions++;
          }
          return subscribe.apply(this, arguments_);
        });
      let session: Awaited<ReturnType<typeof createSession>> | undefined;
      try {
        const registry = {
          posts: defineCollection({
            loader: kind === "glob" ? glob({ pattern: "*.md", base }) : file(filename),
            schema: z.object({ title: z.string() }),
          }),
        };
        session = await createSession<typeof registry>({
          root,
          config: "unused",
          outDir: ".content-query",
          registry,
          watch: true,
        });
        expect(sourceSubscriptions).toBe(1);
        const listing = loadAll(session.collections).posts.select("title");
        await writeFile(
          filename,
          kind === "glob"
            ? "---\ntitle: Updated\n---\n"
            : JSON.stringify([{ id: "post", title: "Updated" }]),
        );
        await vi.waitFor(async () => expect(await listing.all()).toEqual([{ title: "Updated" }]));
      } finally {
        await session?.dispose();
        subscriptions.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test.each(["dist", "coverage"])(
    "watches declared glob descendants under %s when the base is covered by the project watcher",
    async (directory) => {
      const root = await realpath(
        await mkdtemp(path.join(os.tmpdir(), "content-query-nested-watch-")),
      );
      const base = path.join(root, "content");
      const nested = path.join(base, directory);
      const filename = path.join(nested, "post.md");
      await mkdir(base);
      const registry = {
        posts: defineCollection({
          loader: glob({ pattern: "**/*.md", base }),
          schema: z.object({ title: z.string() }),
        }),
      };
      const session = await createSession<typeof registry>({
        root,
        config: "unused",
        outDir: ".content-query",
        registry,
        watch: true,
      });
      try {
        const listing = loadAll(session.collections).posts.select("title");
        // macOS starts native directory subscriptions asynchronously after the watcher is ready, so
        // a directory created immediately can go unreported. Let the base subscription start first.
        await settle();
        await mkdir(nested);
        await writeFile(filename, "---\ntitle: First\n---\n");
        await vi.waitFor(async () => expect(await listing.all()).toEqual([{ title: "First" }]), {
          timeout: 3_000,
        });
        await writeFile(filename, "---\ntitle: Edited\n---\n");
        await vi.waitFor(async () => expect(await listing.all()).toEqual([{ title: "Edited" }]), {
          timeout: 3_000,
        });
        await rm(nested, { recursive: true });
        await vi.waitFor(async () => expect(await listing.all()).toEqual([]), { timeout: 3_000 });
      } finally {
        await session.dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test("finds a file created between a new directory's read and its subscription", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-new-directory-")),
    );
    const base = path.join(root, "content");
    const nested = path.join(base, "dist");
    const filename = path.join(nested, "post.md");
    await mkdir(base);
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const subscribe = NodeFsHandler.prototype._watchWithNodeFs;
    let written: Promise<void> | undefined;
    const subscriptions = vi
      .spyOn(NodeFsHandler.prototype, "_watchWithNodeFs")
      .mockImplementation(function (
        this: NodeFsHandler,
        ...arguments_: Parameters<typeof subscribe>
      ) {
        // Chokidar has already read the new directory. Model a write that lands after its reads
        // but before a working subscription, so no watcher event ever reports the file.
        if (path.resolve(arguments_[0]) === nested) {
          written ??= new Promise((resolve) => {
            setTimeout(() => {
              writeFileSync(filename, "---\ntitle: First\n---\n");
              resolve();
            }, 50);
          });
          return () => {};
        }
        return subscribe.apply(this, arguments_);
      });
    const registry = {
      posts: defineCollection({
        loader: glob({ pattern: "**/*.md", base }),
        schema: z.object({ title: z.string() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    try {
      // Let the base directory's native subscription start before creating the directory.
      await settle();
      await mkdir(nested);
      await vi.waitFor(() => expect(written).toBeDefined());
      await written;
      await vi.waitFor(
        async () =>
          expect(await loadAll(session.collections).posts.select("title").all()).toEqual([
            { title: "First" },
          ]),
        { timeout: 3_000 },
      );
    } finally {
      subscriptions.mockRestore();
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not reload for a new directory without matching files", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-unrelated-directory-")),
    );
    const base = path.join(root, "content");
    await mkdir(base);
    await writeFile(path.join(base, "post.md"), "---\ntitle: First\n---\n");
    const registry = {
      posts: defineCollection({
        loader: glob({ pattern: "**/*.md", base }),
        schema: z.object({ title: z.string() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    // Late native events for files written before startup can still reload once; let them settle.
    await settle();
    await sessionInternals(session).idle();
    const events: string[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event.type));
    try {
      await mkdir(path.join(base, "dist", "images"), { recursive: true });
      await writeFile(path.join(base, "dist", "images", "cover.png"), "");
      // Outlast both new-directory rechecks.
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      expect(events).toEqual([]);
    } finally {
      unsubscribe();
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("watches dependency files outside the project and leaves covered ones alone", async () => {
    const workspace = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-dependency-watch-")),
    );
    const root = path.join(workspace, "project");
    const outside = path.join(workspace, "shared/notes.md");
    const inside = path.join(root, "content/notes.md");
    await mkdir(path.dirname(outside), { recursive: true });
    await mkdir(path.dirname(inside), { recursive: true });
    await writeFile(outside, "Shared");
    await writeFile(inside, "Inside");
    const events: [string, string][] = [];
    const watcher = watchDependencies({
      root,
      config: path.join(root, "content-query.config.ts"),
      registry: () => ({}),
      dependencies: () => undefined,
      configChanged: () => {},
      invalidated: () => {},
      dependencyChanged: (event, filename) => events.push([event, filename]),
      failed: () => {},
    });
    try {
      watcher.add([inside]);
      watcher.add([outside, outside]);
      await settle();
      await writeFile(inside, "Inside, edited");
      await writeFile(outside, "Shared, edited");
      await vi.waitFor(() => expect(events).toContainEqual(["change", outside]), {
        timeout: 3_000,
      });
      expect(events.some(([, filename]) => filename === inside)).toBe(false);
    } finally {
      await watcher.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("recovers a missing source directory when its ancestor creation event is lost", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-watch-gap-")));
    const base = path.join(root, "dist/content");
    const filename = path.join(base, "post.md");
    // Preserve the original method and rebind it to each watcher below.
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const subscribeDirectory = NodeFsHandler.prototype._watchWithNodeFs;
    let ancestorSubscriptions = 0;
    const ancestorEvents = vi
      .spyOn(NodeFsHandler.prototype, "_watchWithNodeFs")
      .mockImplementation(function (
        this: NodeFsHandler,
        ...arguments_: Parameters<typeof subscribeDirectory>
      ) {
        if (path.resolve(arguments_[0]) === root) {
          ancestorSubscriptions++;
          // Reproduce an ancestor notification lost before newly created children are discovered.
          return subscribeDirectory.call(this, arguments_[0], () => undefined);
        }
        return subscribeDirectory.apply(this, arguments_);
      });
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      session = await createSession({
        root,
        config: "unused",
        outDir: ".content-query",
        registry: {
          posts: defineCollection({
            loader: glob({ pattern: "*.md", base }),
            schema: z.object({ title: z.string() }),
          }),
        },
        watch: true,
      });
      const listing = loadAll(session.collections).posts.select("title");
      await mkdir(base, { recursive: true });
      await writeFile(filename, "---\ntitle: First\n---\n");
      await vi.waitFor(async () => expect(await listing.all()).toEqual([{ title: "First" }]), {
        timeout: 3_000,
      });
      expect(ancestorSubscriptions).toBeGreaterThan(0);
      await writeFile(filename, "---\ntitle: Edited\n---\n");
      await vi.waitFor(async () => expect(await listing.all()).toEqual([{ title: "Edited" }]));
    } finally {
      await session?.dispose();
      ancestorEvents.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("excludes generated output even when it matches a declared source glob", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-output-watch-")),
    );
    const output = path.join(root, "generated");
    await writeFile(path.join(root, "post.json"), JSON.stringify({ title: "First" }));
    const published = vi.fn();
    const registry = {
      posts: defineCollection({
        loader: glob({ pattern: "**/*.json", base: root }),
        schema: z.object({ title: z.string() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: output,
      registry,
      watch: true,
      publish: async () => {
        published();
      },
    });
    try {
      await settle();
      await sessionInternals(session).idle();
      const initial = published.mock.calls.length;
      await mkdir(output);
      await writeFile(path.join(output, "artifact.json"), JSON.stringify({ title: "Generated" }));
      await settle();
      await sessionInternals(session).idle();
      expect(published).toHaveBeenCalledTimes(initial);
      expect(await loadAll(session.collections).posts.select("title").all()).toEqual([
        { title: "First" },
      ]);
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
  for (const failure of ["syntax", "invalid-loader"] as const) {
    test(`keeps configuration failures active through content edits: ${failure}`, async () => {
      const fixture = await projectFixture();
      const original = await readFile(fixture.config, "utf8");
      const session = await createSession<{
        posts: {
          loader: import("../loaders/types.ts").Loader;
          schema: z.ZodObject<{ title: z.ZodString }>;
        };
      }>({ root: fixture.root, config: fixture.config, outDir: ".content-query", watch: true });
      const internal = sessionInternals(session);
      const listing = loadAll(session.collections).posts.select("title");
      try {
        const broken =
          failure === "syntax"
            ? "export const collections = { invalid syntax;"
            : original.replace(
                "export const collections = {authors,posts};",
                'const broken = {loader:{name:"broken",load:false}}; export const collections = {authors,posts,broken};',
              );
        await writeFile(fixture.config, broken);
        await vi.waitFor(
          () => expect(listing.first()).rejects.toMatchObject({ code: "source-error" }),
          {
            timeout: 3_000,
          },
        );
        const error = {
          code: "source-error",
          diagnostics: internal.state.error?.diagnostics,
        };
        const previous = internal.state.revision;
        // A config write can emit another notification after its first failure is observable.
        internal.invalidate();
        await internal.idle();
        await writeFile(
          fixture.postPath,
          "---\ntitle: Edited during failure\nauthorId: ada\ndate: 2026-01-01\n---\n# Edited\n",
        );
        await settle();
        await internal.idle();
        expect(internal.state.error).toMatchObject(error);
        expect(internal.state.revision).toBe(previous);
        await expect(
          bodyOf(loadAll(session.collections), "posts", "getting-started"),
        ).rejects.toMatchObject(error);
        await writeFile(fixture.config, original);
        await vi.waitFor(
          async () => expect(await listing.first()).toEqual({ title: "Edited during failure" }),
          {
            timeout: 3_000,
          },
        );
      } finally {
        await session.dispose();
        await fixture.dispose();
      }
    });
  }
  for (const directory of ["dist", "coverage"]) {
    for (const kind of ["glob", "file"] as const) {
      test(`watches a missing ${kind} input under ${directory} through creation, edits, and removal`, async () => {
        const root = await realpath(
          await mkdtemp(path.join(os.tmpdir(), "content-query-declared-watch-")),
        );
        const base = path.join(root, directory, "content");
        const filename = path.join(base, kind === "glob" ? "post.md" : "posts.json");
        const registry = {
          posts: defineCollection({
            loader:
              kind === "glob" ? glob({ pattern: ["*.md", "!draft.md"], base }) : file(filename),
            schema: z.object({ title: z.string() }),
          }),
        };
        const session = await createSession<typeof registry>({
          root,
          config: "unused",
          outDir: ".content-query",
          registry,
          watch: true,
        });
        const listing = loadAll(session.collections).posts.select("title");
        try {
          await mkdir(base, { recursive: true });
          for (const title of ["First", "Edited"]) {
            await writeFile(
              filename,
              kind === "glob"
                ? `---\ntitle: ${title}\n---\n`
                : JSON.stringify([{ id: "post", title }]),
            );
            await vi.waitFor(async () => expect(await listing.all()).toEqual([{ title }]), {
              timeout: 3_000,
            });
          }
          if (kind === "glob") {
            await writeFile(path.join(base, "draft.md"), "---\ntitle: false\n---\n");
            await settle();
            await sessionInternals(session).idle();
            expect(await listing.all()).toEqual([{ title: "Edited" }]);
          }
          await rm(filename);
          await vi.waitFor(
            async () => {
              if (kind === "glob") {
                expect(await listing.all()).toEqual([]);
              } else {
                await expect(listing.all()).rejects.toMatchObject({ code: "source-error" });
              }
            },
            { timeout: 3_000 },
          );
          await writeFile(
            filename,
            kind === "glob"
              ? "---\ntitle: Recovered\n---\n"
              : JSON.stringify([{ id: "post", title: "Recovered" }]),
          );
          await vi.waitFor(
            async () => expect(await listing.all()).toEqual([{ title: "Recovered" }]),
            { timeout: 3_000 },
          );
        } finally {
          await session.dispose();
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
  for (const external of [false, true]) {
    test(`recovers from rapid invalid and corrected writes, external=${external}`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-fast-writes-"));
      const sourceRoot = external
        ? await mkdtemp(path.join(os.tmpdir(), "content-query-fast-external-"))
        : root;
      const filename = path.join(sourceRoot, "entries.json");
      await writeFile(filename, JSON.stringify([{ id: "post", title: "Initial" }]));
      const registry = {
        posts: defineCollection({
          loader: file(filename),
          schema: z.object({ title: z.string() }),
        }),
      };
      const session = await createSession<typeof registry>({
        root,
        config: "unused",
        outDir: ".content-query",
        registry,
        watch: true,
      });
      try {
        const listing = loadAll(session.collections).posts.select("title");
        for (const title of ["First recovery", "Second recovery"]) {
          await writeFile(filename, JSON.stringify([{ id: "post", title: false }]));
          await vi.waitFor(
            () => expect(listing.first()).rejects.toMatchObject({ code: "validation-error" }),
            { interval: 1, timeout: 2_000 },
          );
          await writeFile(filename, JSON.stringify([{ id: "post", title }]));
          await vi.waitFor(async () => expect(await listing.first()).toEqual({ title }), {
            interval: 1,
            timeout: 2_000,
          });
        }
      } finally {
        await session.dispose();
        await rm(root, { recursive: true, force: true });
        if (external) {
          await rm(sourceRoot, { recursive: true, force: true });
        }
      }
    });
  }
  test("reloads only for evaluated config modules, including ones outside the root", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-config-watch-")),
    );
    const shared = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-shared-")));
    const config = path.join(root, "content-query.config.ts");
    const published = vi.fn();
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await mkdir(path.join(root, "lib"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "lib/title.ts"), "export const title: string = 'Local';\n");
    await writeFile(path.join(shared, "suffix.ts"), "export const suffix: string = ' one';\n");
    await writeFile(
      config,
      `import { title } from "./lib/title.ts";
import { suffix } from ${JSON.stringify(path.join(shared, "suffix.ts"))};
export const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title: title + suffix}}); }}}};`,
    );
    const session = await createSession<{
      posts: {
        loader: import("../loaders/types.ts").Loader;
        schema: z.ZodObject<{ title: z.ZodString }>;
      };
    }>({ root, config, outDir: ".content-query", watch: true, change: published });
    const title = () => loadAll(session.collections).posts.select("title").first();
    try {
      expect(await title()).toEqual({ title: "Local one" });
      const initial = published.mock.calls.length;
      await writeFile(path.join(root, "src/Button.tsx"), "export const Button = () => null;\n");
      await writeFile(path.join(root, "unrelated.json"), "{}\n");
      await settle();
      await sessionInternals(session).idle();
      expect(published).toHaveBeenCalledTimes(initial);
      await writeFile(path.join(root, "lib/title.ts"), "export const title: string = 'Edited';\n");
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Edited one" }), {
        interval: 10,
        timeout: 3_000,
      });
      await writeFile(path.join(shared, "suffix.ts"), "export const suffix: string = ' two';\n");
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Edited two" }), {
        interval: 10,
        timeout: 3_000,
      });
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(shared, { recursive: true, force: true });
    }
  });
  test("watches every module while a broken config's module graph is unknown", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-broken-config-")),
    );
    const config = path.join(root, "content-query.config.ts");
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      config,
      `export const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title: "Valid"}}); }}}};`,
    );
    const session = await createSession<{
      posts: {
        loader: import("../loaders/types.ts").Loader;
        schema: z.ZodObject<{ title: z.ZodString }>;
      };
    }>({ root, config, outDir: ".content-query", watch: true });
    const title = () => loadAll(session.collections).posts.select("title").first();
    try {
      await writeFile(
        config,
        `import { title } from "./title.ts";
import { loadAll } from "../../tests/helpers/collections.ts";
export const collections = {posts: {loader: {name: "fixture", async load({store}) { store.set({id: "one", data: {title}}); }}}};`,
      );
      await vi.waitFor(() => expect(title()).rejects.toMatchObject({ code: "source-error" }), {
        interval: 10,
        timeout: 3_000,
      });
      // The missing import was never evaluated, so only conservative watching notices it.
      await writeFile(path.join(root, "title.ts"), "export const title: string = 'Recovered';\n");
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Recovered" }), {
        interval: 10,
        timeout: 3_000,
      });
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
  for (const external of [false, true]) {
    test(`ignores files outside a glob's patterns, external=${external}`, async () => {
      const root = await realpath(
        await mkdtemp(path.join(os.tmpdir(), "content-query-glob-watch-")),
      );
      const base = external
        ? await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-glob-external-")))
        : path.join(root, "content");
      await mkdir(base, { recursive: true });
      await writeFile(path.join(base, "first.md"), "---\ntitle: First\n---\n");
      const published = vi.fn();
      const registry = {
        posts: defineCollection({
          loader: glob({ pattern: ["*.md", "!draft.md"], base }),
          schema: z.object({ title: z.string() }),
        }),
      };
      const session = await createSession<typeof registry>({
        root,
        config: "unused",
        outDir: ".content-query",
        registry,
        watch: true,
        change: published,
      });
      const titles = () => loadAll(session.collections).posts.select("title").all();
      try {
        // Finish any delayed events for the source written before subscription setup.
        await settle();
        await sessionInternals(session).idle();
        const initial = published.mock.calls.length;
        await writeFile(path.join(base, "diagram.png"), "binary");
        await writeFile(path.join(base, "draft.md"), "---\ntitle: Draft\n---\n");
        await writeFile(path.join(base, ".first.md.swp"), "swap");
        await settle();
        await sessionInternals(session).idle();
        expect(published).toHaveBeenCalledTimes(initial);
        await writeFile(path.join(base, "second.md"), "---\ntitle: Second\n---\n");
        await vi.waitFor(
          async () => expect(await titles()).toEqual([{ title: "First" }, { title: "Second" }]),
          { interval: 10, timeout: 3_000 },
        );
      } finally {
        await session.dispose();
        await rm(root, { recursive: true, force: true });
        if (external) {
          await rm(base, { recursive: true, force: true });
        }
      }
    });
  }
});

describe("queryStyle reloading", () => {
  test("applies queryStyle edits from configuration reloads to the live runtime", async () => {
    const fixture = await projectFixture();
    const original = await readFile(fixture.config, "utf8");
    const session = await createSession<{
      posts: {
        loader: import("../loaders/types.ts").Loader;
        schema: z.ZodObject<{ title: z.ZodString }>;
      };
    }>({ root: fixture.root, config: fixture.config, outDir: ".content-query", watch: true });
    const expected = { title: "Getting started" };
    try {
      expect(await session.collections.posts.select("title").first()).toEqual(expected);

      await writeFile(fixture.config, `${original}export const queryStyle = "relational";\n`);
      await vi.waitFor(
        () =>
          expect(() => session.collections.posts.select("title")).toThrow(
            /posts\.select is unavailable because content-query\.config sets queryStyle to "relational"/,
          ),
        { timeout: 3_000 },
      );
      expect(
        await loadAll(session.collections).posts.findFirst({ columns: { title: true } }),
      ).toEqual(expected);

      await writeFile(fixture.config, `${original}export const queryStyle = "fluent";\n`);
      await vi.waitFor(
        () =>
          expect(() => session.collections.posts.findFirst({ columns: { title: true } })).toThrow(
            /posts\.findFirst is unavailable because content-query\.config sets queryStyle to "fluent"/,
          ),
        { timeout: 3_000 },
      );
      expect(await loadAll(session.collections).posts.select("title").first()).toEqual(expected);

      await writeFile(fixture.config, original);
      await vi.waitFor(
        async () =>
          expect(
            await loadAll(session.collections).posts.findFirst({ columns: { title: true } }),
          ).toEqual(expected),
        { timeout: 3_000 },
      );
      expect(await loadAll(session.collections).posts.select("title").first()).toEqual(expected);
    } finally {
      await session.dispose();
      await fixture.dispose();
    }
  });
});
