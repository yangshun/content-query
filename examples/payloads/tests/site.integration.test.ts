import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

const execute = promisify(execFile);
const appRoot = fileURLToPath(new URL("../", import.meta.url));

/** Reads the Markdown body that glob() captures: the source without frontmatter or its gap. */
async function sourceBody(id: string): Promise<string> {
  const source = await readFile(path.join(appRoot, "content/articles", `${id}.md`), "utf8");
  return source.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^(?:[ \t]*\r?\n)+/, "");
}

describe("payloads example", () => {
  let workspace: string;
  let root: string;

  /** Reads one generated page. */
  function read(pathname: string): Promise<string> {
    return readFile(path.join(root, "dist", pathname), "utf8");
  }

  beforeAll(async () => {
    workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-payloads-")));
    root = path.join(workspace, "app");
    for (const source of ["content", "src", "content-query.config.ts", "package.json"]) {
      await cp(path.join(appRoot, source), path.join(root, source), { recursive: true });
    }
    await symlink(path.join(appRoot, "node_modules"), path.join(root, "node_modules"), "dir");
    await execute(
      process.execPath,
      [path.join(appRoot, "node_modules/content-query/dist/cli.mjs"), "build"],
      { cwd: root },
    );
    // The site script reads only prepared artifacts, never sources or configuration.
    await rm(path.join(root, "content"), { recursive: true });
    await rm(path.join(root, "content-query.config.ts"));
    await execute(process.execPath, ["src/site.ts"], { cwd: root });
  }, 60_000);

  afterAll(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("builds a metadata-only index with one fluent payload and supplied HTML", async () => {
    const html = await read("index.html");
    const list = html.match(/<ol class="articles">[\s\S]*?<\/ol>/)?.[0];
    expect(list).toBeDefined();
    const ids = ["writing-for-the-web", "keeping-html-ready", "choosing-what-to-load"];
    const positions = ids.map((id) => list!.indexOf(`href="/articles/${id}.html"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
    expect(list).not.toContain("<h2");
    const latest = html.match(/<section class="latest">[\s\S]*?<\/section>/)?.[0];
    expect(latest).toContain('<h2 id="use-clear-headings">Use clear headings</h2>');
    expect(html).not.toContain("Lists need metadata");
    expect(html).toContain(
      '<aside class="announcement"><h2>The field notes are live</h2><p>New notes arrive every month.',
    );
  });

  test.each(["choosing-what-to-load", "keeping-html-ready", "writing-for-the-web"])(
    "writes %s from one query with rendered and body payloads",
    async (id) => {
      const html = await read(`articles/${id}.html`);
      expect(html).toMatch(/<nav class="contents"><ol><li><a href="#[^"]+">/);
      expect(html).toContain('<h2 id="');
      expect(html).toContain(`<a href="/articles/${id}.md">Markdown source</a>`);
      expect(await read(`articles/${id}.md`)).toBe(await sourceBody(id));
      if (id === "choosing-what-to-load") {
        expect(html).toContain("shiki");
        expect(html).toContain('<a href="/authors/ada.html">Ada</a> on 2026-10-01');
      }
    },
  );

  test("builds a feed from one requested variant of a custom payload", async () => {
    const feed = JSON.parse(await read("feed.json")) as {
      items: { url: string; title: string; summary: string }[];
    };
    expect(feed.items.map((item) => item.url)).toEqual([
      "/articles/writing-for-the-web.html",
      "/articles/keeping-html-ready.html",
      "/articles/choosing-what-to-load.html",
    ]);
    expect(feed.items.at(-1)!.summary).toBe(
      "An index page shows a title and a summary for each article. Loading every article's HTML to draw that list wastes time and memory.",
    );
    expect(feed.items.every((item) => item.summary && !item.summary.includes("\n"))).toBe(true);
  });

  test("loads payloads inside relationship scopes for each author's newest article", async () => {
    const ada = await read("authors/ada.html");
    expect(ada).toContain('Newest: <a href="/articles/keeping-html-ready.html">');
    expect(ada).toContain('<h2 id="compile-during-the-build">');
    expect(ada).not.toContain("Lists need metadata");
    const grace = await read("authors/grace.html");
    expect(grace).toContain('Newest: <a href="/articles/writing-for-the-web.html">');
    expect(grace).toContain('<h2 id="keep-sections-short">');
  });

  test("rejects payload requests that a collection does not offer", async () => {
    const { stdout } = await execute(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { announcements } = await import("./.content-query/collections/announcements/server.js");
const { articles } = await import("./.content-query/collections/articles/server.js");
const { authors } = await import("./.content-query/collections/authors/server.js");
const codes = [];
for (const request of [
  () => authors.findMany({ payloads: { _body: true } }),
  () => articles.count({ payloads: { _rendered: true } }),
]) {
  try { await request(); codes.push("resolved"); } catch (error) { codes.push(error.code); }
}
const announcement = await announcements.findFirst({ payloads: { _body: true } });
console.log(JSON.stringify({ codes, body: announcement._payloads._body ?? null }));`,
      ],
      { cwd: root },
    );
    expect(JSON.parse(stdout)).toEqual({
      codes: ["invalid-query", "invalid-query"],
      body: null,
    });
  });
});
