import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

const execute = promisify(execFile);
const guideIds = [
  "getting-started",
  "organizing-projects",
  "sharing-a-workspace",
  "reference/shortcuts",
];

/** Builds an isolated copy of a real framework example and checks its deployed HTML. */
export function testStaticExample(
  appRoot: string,
  framework: string,
  sources: string[],
  output: string,
  trailingSlash = true,
  buildCommand: string[] = ["run", "build"],
) {
  describe(`${framework} ContentQuery production example`, () => {
    let root: string;
    let workspace: string;
    beforeAll(async () => {
      workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-example-")));
      root = path.join(workspace, "app");
      await mkdir(root);
      for (const source of [
        ...sources,
        "content",
        "content-query.config.ts",
        "vite.config.ts",
        "package.json",
        "tsconfig.json",
      ]) {
        await cp(path.join(appRoot, source), path.join(root, source), { recursive: true });
      }
      await symlink(path.join(appRoot, "node_modules"), path.join(root, "node_modules"), "dir");
      await mkdir(path.join(root, "content/guides/reference"));
      await writeFile(
        path.join(root, "content/guides/reference/shortcuts.md"),
        "---\ntitle: Shortcuts\ndescription: Keep your hands on the keyboard.\norder: 4\n---\n## Moving around\nUse the keyboard to move between notes.\n",
      );
      await execute("vp", buildCommand, {
        cwd: root,
        env: process.env,
        maxBuffer: 2_000_000,
        timeout: 60_000,
      });
      await rm(path.join(root, "content"), { recursive: true });
      await rm(path.join(root, "content-query.config.ts"));
    }, 70_000);
    afterAll(async () => {
      if (workspace) {
        await rm(workspace, { recursive: true, force: true });
      }
    });
    test("exports an ordered metadata-only index without requiring source files", async () => {
      const html = await readFile(path.join(root, output, "index.html"), "utf8");
      const positions = guideIds.map((id) =>
        html.indexOf(`href="/docs/${id}${trailingSlash ? "/" : ""}"`),
      );
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(html).toContain("Make a workspace and give your first project a home.");
      expect(html).not.toContain("Start with a workspace");
      expect(html).toContain('class="site-shell"');
      expect(html).toContain('class="guide-row"');
      expect(html).not.toContain('class="guide-nav"');
    });
    test.each(guideIds)(
      "renders %s with metadata, Markdown, and independent neighbors",
      async (id) => {
        const html = await readFile(path.join(root, output, "docs", id, "index.html"), "utf8");
        expect(html).toContain("<h2");
        expect(html).toContain('class="docs-layout"');
        expect(html).toContain('class="guide-main"');
        expect(html).toContain('class="prose"');
        const sidebar = html.match(/<nav class="guide-nav"[\s\S]*?<\/nav>/)?.[0];
        expect(sidebar).toBeDefined();
        for (const guideId of guideIds) {
          expect(sidebar).toContain(`href="/docs/${guideId}${trailingSlash ? "/" : ""}"`);
        }
        expect(sidebar).toContain('aria-current="page"');
        expect(html).toContain('name="description"');
        const title = html.match(/<h1[^>]*>([^<]+)/)?.[1];
        expect(html).toContain(`<title>${title} | ContentQuery x ${framework}</title>`);
        expect(html).not.toContain('name="description" content=""');
        const navigation = html.match(/<nav class="page-navigation"[\s\S]*?<\/nav>/)?.[0];
        expect(navigation).toBeDefined();
        const index = guideIds.indexOf(id);
        for (const [direction, neighbor] of [
          ["prev", guideIds[index - 1]],
          ["next", guideIds[index + 1]],
        ] as const) {
          if (neighbor) {
            expect(navigation).toContain(`href="/docs/${neighbor}${trailingSlash ? "/" : ""}"`);
            expect(navigation).toContain(`rel="${direction}"`);
          } else {
            expect(navigation).not.toContain(`rel="${direction}"`);
          }
        }
        if (id === "reference/shortcuts") {
          expect(html).toContain('id="moving-around"');
          expect(html).toContain("Keep your hands on the keyboard.");
        }
      },
    );
  });
}
