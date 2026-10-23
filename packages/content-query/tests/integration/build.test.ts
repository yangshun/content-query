import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { buildAtRoot } from "../../src/preparation/build.ts";
import { projectFixture, packageRoot } from "../helpers/project.ts";
import { createArtifactRuntime } from "../../src/internal.ts";

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
import { content, type CollectionData, type CollectionKey } from "./.content-query/server.js";
import { content as virtualContent, type CollectionData as VirtualData } from "content-query:server";
import { eq } from "content-query/query";
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
void session;
const title: CollectionData<"posts">["title"] = "Example";
const key: CollectionKey = "posts";
const virtualTitle: VirtualData<"posts">["title"] = title;
const object: Promise<{title:string;_adjacent:{previous:{id:string}|null;next:{id:string}|null}}[]> = virtualContent.query.posts.findMany({ adjacent: true, columns: { title:true } });
// @ts-expect-error Generated aliases only accept registered collection names.
type Missing = CollectionData<"missing">;
// @ts-expect-error Extra object selection fields remain errors through generated declarations.
content.query.posts.findMany({ columns: { id:true, typo:true } });
void [title, key, virtualTitle, object];
const query = content.select("id", "title").from("posts").with("author",author=>author.select("name"));
const checked: Promise<{id:string;title:string;author:{name:string}}[]> = query.all();
// @ts-expect-error Invalid fields must remain errors through generated declarations.
content.select("typo").from("posts");
// @ts-expect-error Field argument types are inferred from schema outputs.
content.select().from("posts").where(fields=>eq(fields.draft,"false"));
void content.select().from("posts").all();
const direct: PromiseLike<{id:string;title:string}[]> = content.select("id", "title").from("posts");
void direct;
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
            `const {content}=await import("./.content-query/server.js");console.log(JSON.stringify(await content.select("name").from("authors").with("featuredPosts",posts=>posts.select("id")).all()));`,
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
          `const{content}=await import("./.content-query/server.js");const row=await content.select("value", "constructor").from("__proto__").first();console.log(JSON.stringify([row.value,Object.hasOwn(row,"constructor"),row.constructor,await content.readBody("__proto__","__proto__")]));`,
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
        const code = await readFile(path.join(generated, "server.js"), "utf8");
        expect(code.includes("content-query/internal/markdown")).toBe(deferRender);
        expect(code).not.toContain("content-query.config");
        expect(code).not.toContain("zod");
        expect(await readdir(path.join(generated, "collections/authors"))).not.toContain("entries");
        expect(await readFile(path.join(generated, "server.d.ts"), "utf8")).toContain(
          "typeof import",
        );
        await rm(fixture.config);
        await rm(path.join(fixture.root, "content"), { recursive: true });
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
const {content} = await import(${JSON.stringify(pathToFileURL(path.join(generated, "server.js")).href)});
const list = await content.select("title", "date", "upper").from("posts").with("author", author=>author.select("name")).all();
const rendered = await content.render("posts","getting-started");
console.log(JSON.stringify({list,body:await content.readBody("posts","getting-started"),rendered}));
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
        await session.content
          .select()
          .from("posts" as never)
          .count(),
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
const {content}=await import(${JSON.stringify(pathToFileURL(path.join(fixture.root, ".content-query/server.js")).href)});
console.log(await content.select().from("posts").count());
try { await content.readBody("posts","getting-started"); } catch(error) { console.log(error.code); }
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
      const first = await readFile(path.join(fixture.root, ".content-query/server.js"), "utf8");
      await (await buildAtRoot(fixture.root, {})).dispose();
      expect(await readFile(path.join(fixture.root, ".content-query/server.js"), "utf8")).toBe(
        first,
      );
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
      await writeFile(path.join(stale, "index.js"), "export {};");
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
      expect(await readFile(path.join(fixture.root, "prepared/server.js"), "utf8")).toContain(
        "createArtifactRuntime",
      );
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
          'const { content } = await import("./.content-query/server.js"); console.log(JSON.stringify(await content.select("title").from("posts").first()));',
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
  test("incompatible artifact and codec versions require regeneration", () => {
    expect(() =>
      createArtifactRuntime({ version: 999, codec: "devalue-6", collections: {} }, {}),
    ).toThrow(expect.objectContaining({ code: "artifact-error" }));
    expect(() =>
      createArtifactRuntime({ version: 1, codec: "other", collections: {} }, {}),
    ).toThrow(expect.objectContaining({ code: "artifact-error" }));
  });
});
