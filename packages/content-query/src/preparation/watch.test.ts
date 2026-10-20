import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeFsHandler } from "chokidar/handler.js";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../collection/define.ts";
import { file, glob } from "../loaders.ts";
import { createSession, sessionInternals } from "./session.ts";
import { projectFixture } from "../../tests/helpers/project.ts";

/** Gives the watcher time to report an event, if it were going to. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

describe("source watching", () => {
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
      const listing = session.content.query("posts").select("title");
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
      expect(await session.content.query("posts").select("title").all()).toEqual([
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
      const listing = session.content.query("posts").select("title");
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
        await expect(session.content.readBody("posts", "getting-started")).rejects.toMatchObject(
          error,
        );
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
        const listing = session.content.query("posts").select("title");
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
        const listing = session.content.query("posts").select("title");
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
    const title = () => session.content.query("posts").select("title").first();
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
    const title = () => session.content.query("posts").select("title").first();
    try {
      await writeFile(
        config,
        `import { title } from "./title.ts";
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
      const titles = () => session.content.query("posts").select("title").all();
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
