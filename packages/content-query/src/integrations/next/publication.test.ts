import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { ContentError } from "../../shared/errors.ts";
import { buildAtRoot } from "../../preparation/build.ts";
import { sessionInternals } from "../../preparation/session.ts";
import { projectFixture } from "../../../tests/helpers/project.ts";
import { pruneDevelopmentEntries, publishDevelopment } from "./publication.ts";

const execute = promisify(execFile);

describe("Next.js development publication", () => {
  test("startup cleanup preserves the new runtime and unrelated files, while later updates retain earlier runtimes", async () => {
    const fixture = await projectFixture();
    const outDir = path.join(fixture.root, ".content-query");
    try {
      const session = await buildAtRoot(fixture.root, {});
      await session.dispose();
      const state = sessionInternals(session).state;
      const original = await readFile(path.join(outDir, "server.js"), "utf8");
      const stale = publishDevelopment(outDir, fixture.config, state)!;
      await writeFile(path.join(outDir, "next-dev-notes.js"), "Application-owned file");
      await writeFile(path.join(outDir, "server.js"), original);
      const current = publishDevelopment(outDir, fixture.config, state, { prune: true })!;
      await expect(readFile(stale, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(current, "utf8")).toBe(original);
      expect(await readFile(path.join(outDir, "next-dev-notes.js"), "utf8")).toBe(
        "Application-owned file",
      );
      await writeFile(path.join(outDir, "server.js"), original);
      const next = publishDevelopment(outDir, fixture.config, state)!;
      expect(await readFile(current, "utf8")).toBe(original);
      expect(await readFile(next, "utf8")).toBe(original);
    } finally {
      await fixture.dispose();
    }
  });

  test("changes the imported runtime even when publication returns to identical content", async () => {
    const fixture = await projectFixture();
    const outDir = path.join(fixture.root, ".content-query");
    try {
      const session = await buildAtRoot(fixture.root, {});
      await session.dispose();
      const state = sessionInternals(session).state;
      const original = await readFile(path.join(outDir, "server.js"), "utf8");
      const first = publishDevelopment(outDir, fixture.config, state);
      await writeFile(path.join(outDir, "server.js"), original);
      const second = publishDevelopment(outDir, fixture.config, state);
      expect(first).not.toBe(second);
      expect(await readFile(second!, "utf8")).toBe(original);
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'const { content } = await import("./.content-query/server.js"); console.log(JSON.stringify(await content.query("posts").select("title").first()));',
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({ title: "Getting started" });
      await writeFile(path.join(outDir, "server.js"), original);
      await writeFile(path.join(outDir, "next-dev-notes.js"), "Application-owned file");
      pruneDevelopmentEntries(outDir);
      await expect(readFile(first!, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(second!, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(outDir, "next-dev-notes.js"), "utf8")).toBe(
        "Application-owned file",
      );
    } finally {
      await fixture.dispose();
    }
  });
  test("publishes an initial error as a portable runtime with its original diagnostic context", async () => {
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
      publishDevelopment(outDir, fixture.config, { error });
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `try { await import("./.content-query/server.js"); }
catch(error) { console.log(JSON.stringify({code:error.code,source:error.source,path:error.path,minimum:String(error.issues[0].minimum)})); }`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({
        code: "validation-error",
        source: fixture.postPath,
        path: ["title"],
        minimum: "4",
      });
      expect(await readFile(path.join(outDir, "server.d.ts"), "utf8")).toContain(
        "content-query.config",
      );
      const before = await stat(path.join(outDir, "server.js"));
      publishDevelopment(outDir, fixture.config, { error });
      publishDevelopment(outDir, fixture.config, {});
      expect((await stat(path.join(outDir, "server.js"))).ino).toBe(before.ino);
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
