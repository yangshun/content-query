import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { and, eq, gte, isNull, isUndefined, or } from "../../src/query.ts";
import { buildAtRoot } from "../../src/preparation/build.ts";
import type { CollectionHandles } from "../../src/runtime.ts";
import type { collections } from "../fixtures/example/content-query.config.ts";
import { packageRoot, projectFixture } from "../helpers/project.ts";
import { renderedOf } from "../helpers/payloads.ts";

type ExampleContent = CollectionHandles<typeof collections>;

const example = path.join(packageRoot, "tests/fixtures/example");

/** Creates a consumer project containing exactly the PLAN.md living example sources. */
async function exampleProject() {
  const fixture = await projectFixture();
  await rm(path.join(fixture.root, "content"), { recursive: true });
  await cp(path.join(example, "content"), path.join(fixture.root, "content"), { recursive: true });
  await cp(path.join(example, "content-query.config.ts"), fixture.config);
  return fixture;
}

/** Asserts every query, body, render, and error value documented by the PLAN.md example. */
async function expectLivingExample(collections: ExampleContent): Promise<void> {
  // Each collection supplies the other, so relationships work in both directions.
  const posts = collections.posts.using(collections.authors);
  const authors = collections.authors.using(collections.posts);
  // Query a listing through the prepared runtime.
  expect(
    await posts
      .select("id", "title", "slug")
      .where((fields) => and(eq(fields.locale, "en"), eq(fields.draft, false)))
      .where((fields) => gte(fields.publishedAt, new Date("2026-10-01T00:00:00.000Z")))
      .orderBy("publishedAt", "desc")
      .limit(10)
      .all(),
  ).toStrictEqual([{ id: "getting-started", title: "Getting started", slug: "getting-started" }]);

  // Branch from a shared query.
  const publishedPosts = posts.where((fields) => eq(fields.draft, false));
  const englishPosts = publishedPosts.where((fields) => eq(fields.locale, "en"));
  const frenchPosts = publishedPosts.where((fields) => eq(fields.locale, "fr"));
  expect(await englishPosts.select("id", "title").all()).toStrictEqual([
    { id: "getting-started", title: "Getting started" },
  ]);
  expect(await frenchPosts.select("id", "title").all()).toStrictEqual([]);
  expect(await publishedPosts.count()).toBe(1);

  // Select optional fields.
  const subtitles = await posts
    .select("id", "subtitle")
    .where((fields) => eq(fields.locale, "en"))
    .where((fields) => or(isUndefined(fields.subtitle), isNull(fields.subtitle)))
    .all();
  expect(subtitles).toStrictEqual([
    { id: "getting-started", subtitle: undefined },
    { id: "upcoming-features", subtitle: null },
  ]);
  expect(subtitles.map((post) => Object.hasOwn(post, "subtitle"))).toEqual([true, true]);
  expect(await posts.select("subtitel" as never).first()).toStrictEqual({ subtitel: undefined });

  // Read retained raw text.
  const raw = await posts.findFirst({
    where: { id: "getting-started" },
    columns: {},
    payloads: { _body: true },
  });
  const rawMarkdown = raw?._payloads._body;
  expect(rawMarkdown).toBe(
    "# Getting started\n\nWelcome to **VoidPress**.\n\n## Installation\n\nAdd your content.\n",
  );
  expect(rawMarkdown?.startsWith("# Getting started")).toBe(true);
  expect(
    await posts.findFirst({
      where: { id: "missing-post" },
      payloads: { _body: true },
    }),
  ).toBeUndefined();
  // file() collections carry no built-in body or rendered payloads.
  expect(() => authors.findFirst({ payloads: { _body: true } } as never)).toThrow(
    expect.objectContaining({ code: "invalid-query" }),
  );

  // Look up and render a page.
  const post = await posts
    .select("id", "title", "publishedAt")
    .where((fields) =>
      and(eq(fields.slug, "getting-started"), eq(fields.locale, "en"), eq(fields.draft, false)),
    )
    .withPayload("_rendered")
    .first();
  const { _payloads, ...metadata } = post!;
  expect(metadata).toStrictEqual({
    id: "getting-started",
    title: "Getting started",
    publishedAt: new Date("2026-10-17T00:00:00.000Z"),
  });
  const { html, headings } = _payloads._rendered;
  expect(html).toBe(
    [
      '<h1 id="getting-started">Getting started</h1>',
      "<p>Welcome to <strong>VoidPress</strong>.</p>",
      '<h2 id="installation">Installation</h2>',
      "<p>Add your content.</p>",
      "",
    ].join("\n"),
  );
  expect(headings).toStrictEqual([
    { depth: 1, slug: "getting-started", text: "Getting started" },
    { depth: 2, slug: "installation", text: "Installation" },
  ]);

  // Handle errors.
  expect(
    await posts
      .select("id")
      .where((fields) => eq(fields.id, "missing-post"))
      .first(),
  ).toBeUndefined();
  expect(() => authors.findFirst({ payloads: { _rendered: true } } as never)).toThrow(
    expect.objectContaining({ code: "invalid-query" }),
  );
  expect(() => posts.select("id").limit(-1)).toThrow(
    expect.objectContaining({ code: "invalid-query" }),
  );

  // Load related entries in both directions.
  expect(
    await posts
      .select("id", "title")
      .where((fields) => eq(fields.draft, false))
      .with("author", (author) => author.select("name"))
      .all(),
  ).toStrictEqual([
    { id: "getting-started", title: "Getting started", author: { name: "Ada Lovelace" } },
  ]);
  expect(
    await posts
      .select("id")
      .where((fields) => eq(fields.draft, false))
      .with("author", (author) =>
        author.select("name").where((fields) => eq(fields.name, "Grace Hopper")),
      )
      .all(),
  ).toStrictEqual([{ id: "getting-started", author: null }]);
  expect(
    await authors
      .select("id", "name")
      .with("posts", (posts) =>
        posts
          .select("id", "title")
          .where((fields) => eq(fields.draft, false))
          .orderBy("publishedAt", "desc")
          .limit(5),
      )
      .all(),
  ).toStrictEqual([
    {
      id: "ada",
      name: "Ada Lovelace",
      posts: [{ id: "getting-started", title: "Getting started" }],
    },
    { id: "grace", name: "Grace Hopper", posts: [] },
  ]);

  // Load an authored ID array.
  const grace = authors.where((fields) => eq(fields.id, "grace"));
  expect(
    await grace
      .select("id")
      .with("featuredPosts", (posts) => posts.select("id", "title"))
      .first(),
  ).toStrictEqual({
    id: "grace",
    featuredPosts: [
      { id: "upcoming-features", title: "Upcoming features" },
      { id: "getting-started", title: "Getting started" },
      { id: "upcoming-features", title: "Upcoming features" },
    ],
  });
  expect(
    await grace
      .select("id")
      .with("featuredPosts", (posts) =>
        posts.select("id").where((fields) => eq(fields.draft, false)),
      )
      .first(),
  ).toStrictEqual({ id: "grace", featuredPosts: [{ id: "getting-started" }] });
  expect(
    await authors
      .select("id")
      .where((fields) => eq(fields.id, "ada"))
      .with("featuredPosts", (posts) => posts.select("id"))
      .first(),
  ).toStrictEqual({ id: "ada", featuredPosts: [] });
  const featured = grace.select("id").with("featuredPosts", (posts) => posts.select("id"));
  expect(() => featured.with("featuredPosts", (posts) => posts.select("id"))).toThrow(
    expect.objectContaining({ code: "invalid-query" }),
  );
  // Later select() calls add fields, keeping a repeated field once.
  expect(await grace.select("id").select("name", "id").first()).toStrictEqual({
    id: "grace",
    name: "Grace Hopper",
  });

  // Returned values are detached from prepared data and rendering output.
  post!.publishedAt.setUTCFullYear(1999);
  headings.push({ depth: 3, slug: "mutated", text: "Mutated" });
  const curated = await grace.select("featuredPostIds").first();
  curated!.featuredPostIds.length = 0;
  expect(
    await posts
      .select("publishedAt")
      .where((fields) => eq(fields.id, "getting-started"))
      .first(),
  ).toStrictEqual({ publishedAt: new Date("2026-10-17T00:00:00.000Z") });
  expect((await renderedOf(collections, "posts", "getting-started")).headings).toHaveLength(2);
  expect(await grace.select("featuredPostIds").first()).toStrictEqual({
    featuredPostIds: ["upcoming-features", "getting-started", "upcoming-features"],
  });
}

describe("PLAN.md living example", () => {
  test("in-memory preparation returns every documented value", async () => {
    const fixture = await exampleProject();
    try {
      const session = await buildAtRoot<typeof collections>(fixture.root, {
        backend: "in-memory",
      });
      try {
        await expectLivingExample(session.collections);
      } finally {
        await session.dispose();
      }
    } finally {
      await fixture.dispose();
    }
  });
  test("the generated server returns every documented value without sources or config", async () => {
    const fixture = await exampleProject();
    try {
      await (await buildAtRoot(fixture.root, {})).dispose();
      const generated = path.join(fixture.root, ".content-query");
      expect(await readdir(path.join(generated, "collections/authors"))).not.toContain("entries");
      expect(await readdir(path.join(generated, "collections/posts/entries"))).toHaveLength(2);
      for (const name of ["authors", "posts"]) {
        expect(
          await readFile(path.join(generated, "collections", name, "server.js"), "utf8"),
        ).not.toContain("content-query/internal/markdown");
      }
      await rm(fixture.config);
      await rm(path.join(fixture.root, "content"), { recursive: true });
      /** Imports one collection's generated entry, as an application would. */
      const entry = async (name: string) =>
        (await import(
          pathToFileURL(path.join(generated, "collections", name, "server.js")).href
        )) as Partial<ExampleContent>;
      await expectLivingExample({
        posts: (await entry("posts")).posts!,
        authors: (await entry("authors")).authors!,
      });
    } finally {
      await fixture.dispose();
    }
  });
  test("independent invalid sources are reported together with their field paths", async () => {
    const fixture = await exampleProject();
    try {
      const posts = path.join(fixture.root, "content/posts");
      const gettingStarted = path.join(posts, "getting-started.md");
      const upcoming = path.join(posts, "upcoming-features.md");
      await writeFile(
        gettingStarted,
        (await readFile(gettingStarted, "utf8")).replace(
          'publishedAt: "2026-10-17T00:00:00.000Z"',
          'publishedAt: "not-a-date"',
        ),
      );
      await writeFile(
        upcoming,
        (await readFile(upcoming, "utf8")).replace("title: Upcoming features", 'title: ""'),
      );
      await expect(buildAtRoot(fixture.root, { backend: "in-memory" })).rejects.toMatchObject({
        code: "validation-error",
        diagnostics: [
          expect.objectContaining({
            code: "validation-error",
            collection: "posts",
            id: "getting-started",
            source: gettingStarted,
            path: ["publishedAt"],
            issues: expect.any(Array),
          }),
          expect.objectContaining({
            code: "validation-error",
            collection: "posts",
            id: "upcoming-features",
            source: upcoming,
            path: ["title"],
            issues: expect.any(Array),
          }),
        ],
      });
    } finally {
      await fixture.dispose();
    }
  });
});
