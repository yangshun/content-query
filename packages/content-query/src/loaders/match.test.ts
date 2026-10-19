import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glob as discover } from "tinyglobby";
import { describe, expect, test } from "vite-plus/test";
import { file, glob } from "../loaders.ts";
import { builtinLoader, type BuiltinLoader } from "./descriptor.ts";
import { affectsSnapshot } from "./match.ts";

const tree = [
  "a.md",
  "b.txt",
  "image.png",
  ".hidden.md",
  ".dir/c.md",
  "drafts/d.md",
  "posts/e.md",
  "posts/nested/f.md",
  "en/docs/g.md",
  "en/docs/deep/h.md",
  "en/blog/i.md",
];

/** Returns the library-owned descriptor for a glob declaration. */
function globDescriptor(pattern: string | string[]): BuiltinLoader {
  return builtinLoader(glob({ pattern, base: "." }))!;
}

describe("affectsSnapshot", () => {
  test("matches every file discovery returns, and nothing a pattern clearly excludes", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "content-query-match-"));
    try {
      for (const relative of tree) {
        await mkdir(path.dirname(path.join(base, relative)), { recursive: true });
        await writeFile(path.join(base, relative), "");
      }
      const cases: [string | string[], string[]][] = [
        ["**/*.md", ["image.png", "b.txt", ".hidden.md", ".dir/c.md"]],
        [
          ["**/*.md", "!drafts/**"],
          ["drafts/d.md", "image.png"],
        ],
        [
          ["*.md", "!a.md"],
          ["a.md", "posts/e.md"],
        ],
        ["*/docs/**/*.md", ["en/blog/i.md", "a.md"]],
        ["posts", ["a.md", "drafts/d.md"]],
        ["./posts/*.md", ["posts/nested/f.md", "a.md"]],
        ["{posts,drafts}/*.md", ["en/docs/g.md"]],
        ["**/*.{md,txt}", ["image.png"]],
        ["../outside/*.md", []],
      ];
      for (const [pattern, unrelated] of cases) {
        const descriptor = globDescriptor(pattern);
        const discovered = await discover(pattern, { cwd: base, onlyFiles: true, dot: false });
        for (const relative of discovered) {
          expect(
            affectsSnapshot(descriptor, base, "add", path.join(base, relative)),
            `${JSON.stringify(pattern)} must match discovered ${relative}`,
          ).toBe(true);
        }
        for (const relative of unrelated) {
          expect(discovered).not.toContain(relative);
          expect(
            affectsSnapshot(descriptor, base, "change", path.join(base, relative)),
            `${JSON.stringify(pattern)} must ignore ${relative}`,
          ).toBe(false);
        }
      }
      // Patterns re-rooted outside the base conservatively match everything.
      expect(
        affectsSnapshot(globDescriptor("../outside/*.md"), base, "add", path.join(base, "x.png")),
      ).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
  test("treats directory events conservatively and file loaders by exact path", () => {
    const base = path.join(os.tmpdir(), "content-query-events", "content");
    const descriptor = globDescriptor("**/*.md");
    expect(affectsSnapshot(descriptor, base, "addDir", base)).toBe(false);
    expect(affectsSnapshot(descriptor, base, "addDir", path.join(base, "posts"))).toBe(false);
    expect(affectsSnapshot(descriptor, base, "unlinkDir", path.join(base, "posts"))).toBe(true);
    expect(affectsSnapshot(descriptor, base, "unlinkDir", base)).toBe(true);
    expect(affectsSnapshot(descriptor, base, "unlinkDir", path.dirname(base))).toBe(true);
    expect(affectsSnapshot(descriptor, base, "add", path.join(base, "../sibling/a.md"))).toBe(
      false,
    );
    const data = builtinLoader(file("./authors.json"))!;
    const target = path.join(base, "authors.json");
    expect(affectsSnapshot(data, target, "change", target)).toBe(true);
    expect(affectsSnapshot(data, target, "change", path.join(base, "other.json"))).toBe(false);
    expect(affectsSnapshot(data, target, "unlinkDir", base)).toBe(true);
  });
});
