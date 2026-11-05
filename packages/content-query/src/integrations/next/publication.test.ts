import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { ContentError } from "../../shared/errors.ts";
import { buildAtRoot } from "../../preparation/build.ts";
import { sessionInternals } from "../../preparation/session.ts";
import { projectFixture } from "../../../tests/helpers/project.ts";
import { pruneDevelopmentEntries, publishDevelopment } from "./publication.ts";

const execute = promisify(execFile);
const collections = ["authors", "posts"] as const;

/** Builds the fixture once and returns each collection entry's generated source. */
async function built(root: string) {
  const session = await buildAtRoot(root, {});
  await session.dispose();
  const outDir = path.join(root, ".content-query");
  const entries = Object.fromEntries(
    await Promise.all(
      collections.map(async (name) => [
        name,
        await readFile(path.join(outDir, "collections", name, "server.js"), "utf8"),
      ]),
    ),
  ) as Record<(typeof collections)[number], string>;
  /** Restores the generated entries, as writeArtifacts does before each publication. */
  async function restore() {
    for (const name of collections) {
      await writeFile(path.join(outDir, "collections", name, "server.js"), entries[name]);
    }
  }
  return { outDir, entries, restore, state: sessionInternals(session).state };
}

describe("Next.js development publication", () => {
  test("startup cleanup preserves the new runtimes and unrelated files, while later updates retain earlier runtimes", async () => {
    const fixture = await projectFixture();
    try {
      const { outDir, entries, restore, state } = await built(fixture.root);
      const stale = publishDevelopment(outDir, fixture.config, state)!;
      expect(stale.map((runtime) => path.relative(outDir, path.dirname(runtime)))).toEqual([
        "collections/authors",
        "collections/posts",
      ]);
      await writeFile(path.join(outDir, "collections/posts/next-dev-notes.js"), "Application file");
      await restore();
      const current = publishDevelopment(outDir, fixture.config, state, { prune: true })!;
      for (const runtime of stale) {
        await expect(readFile(runtime, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(await readFile(current[1]!, "utf8")).toBe(entries.posts);
      expect(await readFile(path.join(outDir, "collections/posts/server.js"), "utf8")).toBe(
        `export { posts } from "./${path.basename(current[1]!)}";\n`,
      );
      expect(await readFile(path.join(outDir, "collections/posts/next-dev-notes.js"), "utf8")).toBe(
        "Application file",
      );
      await restore();
      const next = publishDevelopment(outDir, fixture.config, state)!;
      expect(await readFile(current[0]!, "utf8")).toBe(entries.authors);
      expect(await readFile(next[0]!, "utf8")).toBe(entries.authors);
    } finally {
      await fixture.dispose();
    }
  });

  test("changes the imported runtimes even when publication returns to identical content", async () => {
    const fixture = await projectFixture();
    try {
      const { outDir, restore, state } = await built(fixture.root);
      const first = publishDevelopment(outDir, fixture.config, state)!;
      await restore();
      const second = publishDevelopment(outDir, fixture.config, state)!;
      expect(first).not.toEqual(second);
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const { posts } = await import("./.content-query/collections/posts/server.js");
const { authors } = await import("./.content-query/collections/authors/server.js");
console.log(JSON.stringify(await posts.using(authors).findFirst({ columns: { title: true }, with: { author: { columns: { name: true } } } })));`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({ title: "Getting started", author: { name: "Ada" } });
      await restore();
      pruneDevelopmentEntries(outDir);
      for (const runtime of [...first, ...second]) {
        await expect(readFile(runtime, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await fixture.dispose();
    }
  });

  test("removes a removed collection's directory once only development entries remain in it", async () => {
    const fixture = await projectFixture();
    try {
      const { outDir, state } = await built(fixture.root);
      const runtimes = publishDevelopment(outDir, fixture.config, state)!;
      const removed = path.join(outDir, "collections/drafts");
      await mkdir(removed);
      await writeFile(
        path.join(removed, "next-dev-00000000-0000-0000-0000-000000000000.js"),
        "Previous run",
      );
      pruneDevelopmentEntries(outDir, path.basename(runtimes[0]!));
      await expect(readdir(removed)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(runtimes[1]!, "utf8")).toContain("createArtifactCollection");
      expect(await readdir(path.join(outDir, "collections"))).toEqual(["authors", "posts"]);
    } finally {
      await fixture.dispose();
    }
  });

  test("publishes an error to every collection entry with its original diagnostic context", async () => {
    const fixture = await projectFixture();
    const outDir = path.join(fixture.root, ".content-query");
    try {
      const error = new ContentError({
        code: "validation-error",
        operation: "build",
        collection: "posts",
        source: fixture.postPath,
        path: ["title"],
        message: "Expected a title",
        issues: [{ minimum: 4n }],
      });
      publishDevelopment(outDir, fixture.config, {
        error,
        registry: { posts: { relationships: {} }, "blog-posts": { relationships: {} } },
      });
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const results = [];
for (const name of ["posts", "blogPosts"]) {
  try { await import("./.content-query/collections/" + name + "/server.js"); }
  catch(error) { results.push({code:error.code,source:error.source,path:error.path,minimum:String(error.issues[0].minimum)}); }
}
console.log(JSON.stringify(results));`,
        ],
        { cwd: fixture.root },
      );
      const diagnostic = {
        code: "validation-error",
        source: fixture.postPath,
        path: ["title"],
        minimum: "4",
      };
      expect(JSON.parse(stdout)).toEqual([diagnostic, diagnostic]);
      expect(
        await readFile(path.join(outDir, "collections/blogPosts/server.d.ts"), "utf8"),
      ).toMatch(
        /content-query\.config[\s\S]*export declare const blogPosts:[\s\S]*export type ContentBlogPost</,
      );
      const before = await stat(path.join(outDir, "collections/posts/server.js"));
      publishDevelopment(outDir, fixture.config, { error });
      publishDevelopment(outDir, fixture.config, {});
      expect((await stat(path.join(outDir, "collections/posts/server.js"))).ino).toBe(before.ino);
    } finally {
      await fixture.dispose();
    }
  });

  test("publishes an error to entries from an earlier build when the registry is unknown", async () => {
    const fixture = await projectFixture();
    try {
      const { outDir } = await built(fixture.root);
      publishDevelopment(outDir, fixture.config, {
        error: new ContentError({ code: "source-error", message: "Invalid config" }),
      });
      for (const name of collections) {
        const source = await readFile(path.join(outDir, "collections", name, "server.js"), "utf8");
        expect(source).toContain("throw restoreContentError(");
        expect(source).toContain(`export const ${name} = undefined;`);
      }
    } finally {
      await fixture.dispose();
    }
  });

  test("surfaces a filesystem failure instead of hiding failed diagnostic publication", async () => {
    const fixture = await projectFixture();
    try {
      const outDir = path.join(fixture.root, "occupied");
      await writeFile(outDir, "An application-owned file");
      expect(() =>
        publishDevelopment(outDir, fixture.config, {
          error: new ContentError({ code: "source-error", message: "Invalid source" }),
        }),
      ).toThrow();
      expect(await readFile(outDir, "utf8")).toBe("An application-owned file");
    } finally {
      await fixture.dispose();
    }
  });
});
