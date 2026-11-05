import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { buildAtRoot } from "../../src/preparation/build.ts";
import { projectFixture, packageRoot } from "../helpers/project.ts";
import { createArtifactCollections } from "../../src/internal.ts";

const execute = promisify(execFile);

describe("portable content builds and production consumption", () => {
  test(
    "executes the living example and checks the real generated declaration surface",
    { timeout: 30_000 },
    async () => {
      const fixture = await projectFixture();
      try {
        const example = path.join(packageRoot, "tests/fixtures/example");
        await rm(path.join(fixture.root, "content"), { recursive: true });
        await cp(path.join(example, "content"), path.join(fixture.root, "content"), {
          recursive: true,
        });
        await cp(path.join(example, "content-query.config.ts"), fixture.config);
        await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'const { buildContent } = await import("content-query/build"); const session = await buildContent(); await session.dispose();',
          ],
          { cwd: fixture.root },
        );
        await symlink(
          path.join(packageRoot, "node_modules/next"),
          path.join(fixture.root, "node_modules/next"),
          "dir",
        );
        await writeFile(
          path.join(fixture.root, "consumer.ts"),
          `/// <reference path="./.content-query/types.d.ts" />
import { posts, type ContentPost } from "./.content-query/collections/posts/server.js";
import { authors, type ContentAuthor } from "./.content-query/collections/authors/server.js";
import { posts as virtualPosts, type ContentPost as VirtualPost } from "content-query:collections/posts";
import { authors as virtualAuthors } from "content-query:collections/authors";
import type { QueryData } from "content-query";
import { eq, has, type CursorPage, type NumberedPage } from "content-query/query";
import { buildContent, type BuildContentOptions, type ContentSession } from "content-query/build";
import { withContentQuery, type NextContentOptions } from "content-query/next";
import type { collections } from "./content-query.config.ts";
const nextOptions: NextContentOptions = { config: "content-query.config.ts", outDir: ".content-query" };
const nextConfig = withContentQuery({ output: "export" }, nextOptions);
const configured: Promise<import("next").NextConfig> = nextConfig("phase-production-server", {defaultConfig:{}});
// @ts-expect-error The Next adapter owns the watch lifecycle.
withContentQuery({}, { watch: true });
void configured;
const buildOptions: BuildContentOptions = { backend: "in-memory" };
const session: Promise<ContentSession<typeof collections>> = buildContent<typeof collections>(buildOptions);
const sessionTitles = session.then(({ collections }) => collections.posts.select("title").all());
void sessionTitles;
const title: ContentPost["title"] = "Example";
const virtualTitle: VirtualPost["title"] = title;
const name: ContentAuthor["name"] = "Ada";
type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
const fullEntry: Equal<ContentPost, QueryData<typeof collections.posts>> = true;
const fluentPicked = posts.select("id", "title", "subtitle").all();
const fluentEntry: Equal<Awaited<typeof fluentPicked>[number], ContentPost<"id" | "title" | "subtitle">> = true;
const relationalPicked = virtualPosts.findMany({ columns: { id: true, subtitle: true } });
const relationalEntry: Equal<Awaited<typeof relationalPicked>[number], VirtualPost<"id" | "subtitle">> = true;
const pickedSubtitle: Equal<ContentPost<"subtitle">, { subtitle: string | null | undefined }> = true;
void [fullEntry, fluentEntry, relationalEntry, pickedSubtitle];
// @ts-expect-error Picked fields must belong to the collection.
type MissingField = ContentPost<"typo">;
const numbered = posts.select("id", "title").orderBy("title").paginate({ page: 1, size: 2 });
const numberedEntry: Equal<Awaited<typeof numbered>, NumberedPage<ContentPost<"id" | "title">>> = true;
const cursorPage = virtualPosts.paginate({ columns: { id: true }, size: 2, after: null, total: true });
const cursorEntry: Equal<Awaited<typeof cursorPage>, CursorPage<VirtualPost<"id">, true>> = true;
void [numberedEntry, cursorEntry];
// @ts-expect-error paginate() owns limit and offset through generated declarations.
posts.select("id").limit(1).paginate({ page: 1, size: 2 });
const object: Promise<{title:string;_adjacent:{previous:{id:string}|null;next:{id:string}|null}}[]> = virtualPosts.findMany({ adjacent: { scope: "results", columns: { id: true } }, columns: { title:true } });
// @ts-expect-error Extra object selection fields remain errors through generated declarations.
posts.findMany({ columns: { id:true, typo:true } });
void [title, virtualTitle, name, object];
// @ts-expect-error A relationship into a collection that was not supplied is unavailable.
posts.select("id").with("author", author => author.select("name"));
// @ts-expect-error Relationship filters need the related collection too.
posts.findMany({ columns: { id: true }, where: { author: { name: "Ada" } } });
// @ts-expect-error Fluent relationship filters need the related collection too.
posts.where(fields => has(fields.author)).count();
const query = posts.using(authors).select("id", "title").with("author",author=>author.select("name"));
const checked: Promise<{id:string;title:string;author:{name:string}}[]> = query.all();
const filtered: Promise<{id:string}[]> = virtualPosts.using(virtualAuthors).findMany({ columns: { id: true }, where: { author: { name: "Ada" } } });
const reverse = authors.using(posts).findMany({ columns: { name: true }, with: { posts: { columns: { id: true } } } });
const reverseRows: Promise<{ name: string; posts: { id: string }[] }[]> = reverse;
// @ts-expect-error A collection export only queries its own collection.
void posts.from;
// @ts-expect-error using() accepts collection exports only.
posts.using({});
// @ts-expect-error Invalid fields must remain errors through generated declarations.
posts.select("typo");
// @ts-expect-error Field argument types are inferred from schema outputs.
posts.where(fields=>eq(fields.draft,"false"));
// @ts-expect-error Unselected queries cannot run through generated declarations.
void posts.where(fields=>eq(fields.draft,false)).all();
const direct: PromiseLike<{id:string;title:string}[]> = posts.select("id", "title");
void [direct, filtered, reverseRows];
void checked;
`,
        );
        await execute(
          process.execPath,
          [
            path.join(packageRoot, "node_modules/tsrs/bin/tsrs"),
            "--noEmit",
            "--strict",
            "--skipLibCheck",
            "--module",
            "nodenext",
            "--target",
            "esnext",
            "--allowImportingTsExtensions",
            "consumer.ts",
          ],
          { cwd: fixture.root },
        );
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `const {authors}=await import("./.content-query/collections/authors/server.js");const {posts}=await import("./.content-query/collections/posts/server.js");console.log(JSON.stringify(await authors.using(posts).select("name").with("featuredPosts",posts=>posts.select("id")).all()));`,
          ],
          { cwd: fixture.root },
        );
        expect(JSON.parse(stdout)).toEqual([
          { name: "Ada Lovelace", featuredPosts: [] },
          {
            name: "Grace Hopper",
            featuredPosts: [
              { id: "upcoming-features" },
              { id: "getting-started" },
              { id: "upcoming-features" },
            ],
          },
        ]);
      } finally {
        await fixture.dispose();
      }
    },
  );
  test("supports prototype-like collection/entry IDs and ordinary computed names", async () => {
    const fixture = await projectFixture();
    try {
      await writeFile(
        fixture.config,
        `import{defineCollection}from"content-query";import { schema } from "content-query/schema";export const collections={['__proto__']:defineCollection({loader:{name: "fixture", async load({store}) { store.set({id:'__proto__',data:{value:3},body:''}); }},schema:schema.object({value:schema.number()}),computed:{constructor:{schema:schema.string(),resolve:()=>"computed"}}})};`,
      );
      await (await buildAtRoot(fixture.root, {})).dispose();
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const entry=await import("./.content-query/collections/__proto__/server.js");const collection=entry["__proto__"];const row=await collection.select("value", "constructor").first();console.log(JSON.stringify([row.value,Object.hasOwn(row,"constructor"),row.constructor,(await collection.findFirst({where:{id:"__proto__"},payloads:{_body:true}}))._payloads._body]));`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual([3, true, "computed", ""]);
    } finally {
      await fixture.dispose();
    }
  });
  test("rejects an output directory that could overwrite the application package", async () => {
    const fixture = await projectFixture();
    try {
      const before = await readFile(path.join(fixture.root, "package.json"), "utf8");
      await expect(buildAtRoot(fixture.root, { outDir: "." })).rejects.toMatchObject({
        code: "source-error",
      });
      await symlink(fixture.root, path.join(fixture.root, "output-link"), "dir");
      await expect(buildAtRoot(fixture.root, { outDir: "./output-link" })).rejects.toMatchObject({
        code: "source-error",
      });
      expect(await readFile(path.join(fixture.root, "package.json"), "utf8")).toBe(before);
    } finally {
      await fixture.dispose();
    }
  });
  for (const deferRender of [false, true]) {
    test(`renders without configuration or sources, deferRender=${deferRender}`, async () => {
      const fixture = await projectFixture(deferRender, false);
      try {
        const session = await buildAtRoot(fixture.root, {});
        await session.dispose();
        const generated = path.join(fixture.root, ".content-query");
        const code = await readFile(path.join(generated, "collections/posts/server.js"), "utf8");
        expect(code.includes("content-query/internal/markdown")).toBe(deferRender);
        expect(code).not.toContain("content-query.config");
        expect(code).not.toContain("zod");
        // The authors entry never needs the renderer, which only posts can use.
        expect(
          await readFile(path.join(generated, "collections/authors/server.js"), "utf8"),
        ).not.toContain("content-query/internal/markdown");
        expect(await readdir(path.join(generated, "collections/authors"))).not.toContain("entries");
        expect(
          await readFile(path.join(generated, "collections/posts/server.d.ts"), "utf8"),
        ).toContain("typeof import");
        await rm(fixture.config);
        await rm(path.join(fixture.root, "content"), { recursive: true });
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
const {posts} = await import(${JSON.stringify(pathToFileURL(path.join(generated, "collections/posts/server.js")).href)});
const {authors} = await import(${JSON.stringify(pathToFileURL(path.join(generated, "collections/authors/server.js")).href)});
const list = await posts.using(authors).select("title", "date", "upper").with("author", author=>author.select("name")).all();
const {_payloads: {_body: body, _rendered: rendered}} = await posts.findFirst({where:{id:"getting-started"},payloads:{_body:true,_rendered:true}});
console.log(JSON.stringify({list,body,rendered}));
`,
          ],
          { cwd: fixture.root },
        );
        const result = JSON.parse(stdout);
        expect(result.list).toEqual([
          {
            title: "Getting started",
            date: "2026-01-01T00:00:00.000Z",
            upper: "GETTING STARTED",
            author: { name: "Ada" },
          },
        ]);
        expect(result).not.toHaveProperty("body");
        expect(result.rendered.headings.map((heading: { slug: string }) => heading.slug)).toEqual([
          "hello",
          "hello-1",
        ]);
        expect(result.rendered.html).toContain('id="hello-1"');
        expect(result.rendered.html).toContain('href="/public/page"');
        expect(result.rendered.html).toContain("shiki");
      } finally {
        await fixture.dispose();
      }
    });
  }
  test("in-memory preparation emits no backend artifacts", async () => {
    const fixture = await projectFixture();
    try {
      const session = await buildAtRoot(fixture.root, { backend: "in-memory" });
      expect(
        await (
          session.collections as unknown as Record<string, { count(): Promise<number> }>
        ).posts!.count(),
      ).toBe(1);
      expect(await readdir(fixture.root)).not.toContain(".content-query");
      await session.dispose();
    } finally {
      await fixture.dispose();
    }
  });
  test("metadata queries never import payload modules; payload I/O errors are distinct", async () => {
    const fixture = await projectFixture();
    try {
      await (await buildAtRoot(fixture.root, {})).dispose();
      const directory = path.join(fixture.root, ".content-query/collections/posts/entries");
      const payload = path.join(directory, (await readdir(directory))[0]!);
      await rm(payload);
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
const {posts}=await import(${JSON.stringify(pathToFileURL(path.join(fixture.root, ".content-query/collections/posts/server.js")).href)});
console.log(await posts.count());
try { await posts.findFirst({where:{id:"getting-started"},payloads:{_body:true}}); } catch(error) { console.log(error.code); }
`,
        ],
        { cwd: fixture.root },
      );
      expect(stdout.trim().split("\n")).toEqual(["1", "artifact-error"]);
    } finally {
      await fixture.dispose();
    }
  });
  test("keeps unchanged artifact bytes and timestamps stable", async () => {
    const fixture = await projectFixture();
    try {
      await (await buildAtRoot(fixture.root, {})).dispose();
      const entry = path.join(fixture.root, ".content-query/collections/posts/server.js");
      const first = await readFile(entry, "utf8");
      const before = await stat(entry);
      await (await buildAtRoot(fixture.root, {})).dispose();
      expect(await readFile(entry, "utf8")).toBe(first);
      expect((await stat(entry)).mtimeMs).toBe(before.mtimeMs);
      const directory = path.join(fixture.root, ".content-query/collections/posts/entries");
      const payload = path.join(directory, (await readdir(directory))[0]!);
      await writeFile(payload, "export default 'corrupted';");
      await expect(buildAtRoot(fixture.root, {})).rejects.toMatchObject({
        code: "artifact-error",
      });
      expect(await readFile(payload, "utf8")).toBe("export default 'corrupted';");
    } finally {
      await fixture.dispose();
    }
  });
  test("one-shot preparation prunes superseded modules; watch sessions retain them", async () => {
    const fixture = await projectFixture();
    const generated = path.join(fixture.root, ".content-query");
    const posts = path.join(generated, "collections/posts");
    const listing = async () => ({
      indexes: (await readdir(posts)).filter((name) => name.startsWith("index-")),
      entries: await readdir(path.join(posts, "entries")),
    });
    try {
      await (await buildAtRoot(fixture.root, {})).dispose();
      const first = await listing();
      const stale = path.join(generated, "collections/removed");
      const hash = "a".repeat(64);
      await mkdir(path.join(stale, "entries"), { recursive: true });
      await writeFile(path.join(stale, "server.js"), "export {};");
      await writeFile(path.join(stale, "server.d.ts"), "export {};");
      await writeFile(path.join(stale, `index-${hash}.js`), "export {};");
      await writeFile(path.join(stale, `entries/${hash}.js`), "export {};");
      await writeFile(path.join(generated, "collections/.DS_Store"), "");
      await writeFile(path.join(posts, "notes.txt"), "kept");
      const original = await readFile(fixture.postPath, "utf8");
      await writeFile(fixture.postPath, `${original}\nEdited.\n`);
      await (await buildAtRoot(fixture.root, {})).dispose();
      const second = await listing();
      expect(second.indexes).toHaveLength(1);
      expect(second.entries).toHaveLength(1);
      expect(second.indexes).not.toEqual(first.indexes);
      expect(second.entries).not.toEqual(first.entries);
      expect(await readdir(path.join(generated, "collections"))).not.toContain("removed");
      expect(await readFile(path.join(posts, "notes.txt"), "utf8")).toBe("kept");
      expect((await readdir(generated)).sort()).toEqual([
        "collections",
        "package.json",
        "types.d.ts",
      ]);

      const session = await buildAtRoot(fixture.root, { watch: true });
      try {
        const before = await listing();
        await writeFile(fixture.postPath, `${original}\nWatched.\n`);
        await vi.waitFor(async () => expect((await listing()).entries.length).toBeGreaterThan(1), {
          interval: 10,
          timeout: 3_000,
        });
        const after = await listing();
        expect(after.entries).toEqual(expect.arrayContaining(before.entries));
        expect(after.indexes).toEqual(expect.arrayContaining(before.indexes));
      } finally {
        await session.dispose();
      }
    } finally {
      await fixture.dispose();
    }
  });
  test("CLI rejects unknown flags, resolves paths from cwd, and emits a portable server", async () => {
    const fixture = await projectFixture();
    try {
      await rename(fixture.config, path.join(fixture.root, "content-query.config.mjs"));
      const cli = path.join(packageRoot, "dist/cli.mjs");
      await expect(
        execute(process.execPath, [cli, "prepare"], { cwd: fixture.root }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("Usage: content-query build"),
      });
      await expect(
        execute(process.execPath, [cli, "build", "--target", "ssr"], { cwd: fixture.root }),
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Unknown option") });
      await expect(
        execute(process.execPath, [cli, "build", "--backend", "sqlite"], { cwd: fixture.root }),
      ).rejects.toMatchObject({ code: 1 });
      await execute(process.execPath, [cli, "build", "--backend=generated", "-o", "./prepared"], {
        cwd: fixture.root,
      });
      expect(
        await readFile(path.join(fixture.root, "prepared/collections/posts/server.js"), "utf8"),
      ).toContain("createArtifactCollection");
      await writeFile(fixture.postPath, "---\ntitle: false\n---\n");
      await expect(
        execute(process.execPath, [cli, "build"], { cwd: fixture.root }),
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("validation-error") });
    } finally {
      await fixture.dispose();
    }
  });
  test("CLI help and version work without executing collection configuration", async () => {
    const fixture = await projectFixture();
    try {
      await writeFile(fixture.config, 'throw new Error("Configuration must not execute");');
      const cli = path.join(packageRoot, "dist/cli.mjs");
      const { version } = JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      ) as { version: string };
      for (const arguments_ of [
        ["--help"],
        ["build", "--help"],
        ["--version"],
        ["build", "--version"],
      ]) {
        const { stdout, stderr } = await execute(process.execPath, [cli, ...arguments_], {
          cwd: fixture.root,
        });
        expect(stdout).toContain(`content-query/${version}`);
        expect(stderr).toBe("");
        if (arguments_.includes("--help")) {
          expect(stdout).toContain("build");
        }
      }
      expect(await readdir(fixture.root)).not.toContain(".content-query");
    } finally {
      await fixture.dispose();
    }
  });
  test("CLI watch rebuilds changed content and shuts down on SIGTERM", async () => {
    const fixture = await projectFixture();
    const cli = path.join(packageRoot, "dist/cli.mjs");
    const child = spawn(process.execPath, [cli, "build", "-w"], {
      cwd: fixture.root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    try {
      await vi.waitFor(() => expect(stdout).toContain("Content ready."), { timeout: 3_000 });
      const original = await readFile(fixture.postPath, "utf8");
      await writeFile(
        fixture.postPath,
        original.replace("title: Getting started", "title: Watched through CLI"),
      );
      await vi.waitFor(() => expect(stdout.match(/Content ready\./g)).toHaveLength(2), {
        timeout: 3_000,
      });
      const selected = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'const { posts } = await import("./.content-query/collections/posts/server.js"); console.log(JSON.stringify(await posts.select("title").first()));',
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(selected.stdout)).toEqual({ title: "Watched through CLI" });
      expect(stderr).toBe("");
      child.kill("SIGTERM");
      expect(await closed).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await closed;
      await fixture.dispose();
    }
  });
  test(
    "queryStyle narrows generated declarations and is enforced by the generated server",
    { timeout: 30_000 },
    async () => {
      const fixture = await projectFixture();
      try {
        await writeFile(
          fixture.config,
          `${await readFile(fixture.config, "utf8")}export const queryStyle = "relational";\n`,
        );
        await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'const { buildContent } = await import("content-query/build"); const session = await buildContent(); await session.dispose();',
          ],
          { cwd: fixture.root },
        );
        await writeFile(
          path.join(fixture.root, "consumer.ts"),
          `/// <reference path="./.content-query/types.d.ts" />
import { posts } from "./.content-query/collections/posts/server.js";
import { posts as virtualPosts } from "content-query:collections/posts";
import { buildContent } from "content-query/build";
import type { collections, queryStyle } from "./content-query.config.ts";
const titles: Promise<{ title: string }[]> = posts.findMany({ columns: { title: true } });
const total: Promise<number> = posts.count({ where: { title: "Getting started" } });
const virtualTitles: Promise<{ title: string }[]> = virtualPosts.findMany({ columns: { title: true } });
// @ts-expect-error The generated export follows queryStyle in content-query.config.
posts.select("title");
// @ts-expect-error The Vite virtual module follows the same setting.
virtualPosts.select("title");
const session = await buildContent<typeof collections, typeof queryStyle>({ backend: "in-memory" });
void session.collections.posts.findFirst({ columns: { title: true } });
// @ts-expect-error Standalone sessions are narrowed by the style type argument.
session.collections.posts.select("title");
void [titles, total, virtualTitles];
export {};
`,
        );
        await execute(
          process.execPath,
          [
            path.join(packageRoot, "node_modules/tsrs/bin/tsrs"),
            "--noEmit",
            "--strict",
            "--skipLibCheck",
            "--module",
            "nodenext",
            "--target",
            "esnext",
            "--allowImportingTsExtensions",
            "consumer.ts",
          ],
          { cwd: fixture.root },
        );
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `const {posts}=await import("./.content-query/collections/posts/server.js");
let rejected;
try { posts.select("title"); } catch (error) { rejected = { code: error.code, message: error.message }; }
const titles = await posts.findMany({ columns: { title: true } });
console.log(JSON.stringify({ rejected, titles }));`,
          ],
          { cwd: fixture.root },
        );
        expect(JSON.parse(stdout)).toEqual({
          rejected: {
            code: "invalid-query",
            message:
              'posts.select is unavailable because content-query.config sets queryStyle to "relational".',
          },
          titles: [{ title: "Getting started" }],
        });
      } finally {
        await fixture.dispose();
      }
    },
  );

  test("incompatible artifact and codec versions require regeneration", () => {
    expect(() =>
      createArtifactCollections({ version: 999, codec: "devalue-6", collections: {} }, {}),
    ).toThrow(expect.objectContaining({ code: "artifact-error" }));
    expect(() =>
      createArtifactCollections({ version: 1, codec: "other", collections: {} }, {}),
    ).toThrow(expect.objectContaining({ code: "artifact-error" }));
  });
});
