import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { appRoot, bundlerArguments, createFixture, nextReleases } from "./next-releases";

const execute = promisify(execFile);
const guideIds = ["getting-started", "organizing-projects", "sharing-a-workspace"];
// Next.js 15.0 has no Turbopack production builds.
const builds = nextReleases.flatMap((release) =>
  (["webpack", "turbopack"] as const)
    .filter((bundler) => bundler === "webpack" || release.packageName !== "next-15.0")
    .map((bundler) => ({ release, bundler, label: `Next.js ${release.version} ${bundler}` })),
);

describe.each(builds)("$label example with inline page queries", ({ release, bundler }) => {
  let root: string;
  let workspace: string;

  beforeAll(async () => {
    const fixture = await createFixture(release);
    ({ root, workspace } = fixture);
    await mkdir(path.join(root, "content/guides/reference"));
    await writeFile(
      path.join(root, "content/guides/reference/shortcuts.md"),
      "---\ntitle: Shortcuts\ndescription: Keep your hands on the keyboard.\norder: 4\n---\n## Moving around\nUse the keyboard to move between notes.\n",
    );

    // Build the actual page modules, then remove the sources the export must not need.
    await execute(
      process.execPath,
      [fixture.next, "build", ...bundlerArguments(release, bundler)],
      {
        cwd: root,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        maxBuffer: 2_000_000,
        timeout: 90_000,
      },
    );
    await rm(path.join(root, "content"), { recursive: true });
    await rm(path.join(root, "content-query.config.ts"));
  }, 100_000);

  afterAll(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("exports an ordered metadata-only homepage without requiring source files", async () => {
    const html = await readFile(path.join(root, "out/index.html"), "utf8");
    const ids = [...guideIds, "reference/shortcuts"];
    const positions = ids.map((id) => html.indexOf(`href="/docs/${id}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
    expect(html).toContain("Make a workspace and give your first project a home.");
    expect(html).not.toContain("Start with a workspace");
    expect(html).not.toMatch(/href="\/docs\/[^"]+\/"/);
    expect(html).toContain('href="/contents"');
  });

  test.each(guideIds)("renders %s with metadata and ordered navigation neighbors", async (id) => {
    const html = await readFile(path.join(root, "out/docs", `${id}.html`), "utf8");
    const ids = [...guideIds, "reference/shortcuts"];
    const index = ids.indexOf(id);
    const navigation = html.match(/<nav class="page-navigation"[\s\S]*?<\/nav>/)?.[0];
    expect(html).toContain("<h2");
    expect(html).toContain("<ul>");
    expect(html).toContain("| ContentQuery x Next.js</title>");
    expect(navigation).toBeDefined();
    const sidebar = html.match(/<nav class="guide-nav"[\s\S]*?<\/nav>/)?.[0];
    expect(sidebar).toBeDefined();
    for (const guideId of ids) {
      expect(sidebar).toContain(`href="/docs/${guideId}"`);
    }
    expect(sidebar).toContain('aria-current="page"');
    if (index > 0) {
      expect(navigation).toContain(`href="/docs/${ids[index - 1]}"`);
      expect(navigation).toContain('rel="prev"');
    } else {
      expect(navigation).not.toContain('rel="prev"');
    }
    expect(navigation).toContain(`href="/docs/${ids[index + 1]}"`);
    expect(navigation).toContain('rel="next"');
    if (id === "getting-started") {
      expect(html).toContain("newNoteTemplate");
      expect(html).toContain('href="/docs/organizing-projects"');
    }
    const source = html.match(/<details class="prose markdown-source">[\s\S]*?<\/details>/)?.[0];
    expect(source).toContain("<summary>Markdown source</summary>");
    expect(source).toMatch(/<code>## /);
    expect(source).not.toContain("<h2");
  });

  test("lists every guide's sections from rendered payloads on the contents page", async () => {
    const html = await readFile(path.join(root, "out/contents.html"), "utf8");
    const list = html.match(/<ol class="contents-list">[\s\S]*?<\/ol>/)?.[0];
    const ids = [...guideIds, "reference/shortcuts"];
    const positions = ids.map((id) => list?.indexOf(`href="/docs/${id}"`) ?? -1);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
    expect(list).toContain('href="/docs/getting-started#start-with-a-workspace"');
    expect(list).toContain('href="/docs/sharing-a-workspace#keep-the-conversation-close"');
    expect(list).toContain('href="/docs/reference/shortcuts#moving-around"');
    expect(html).toContain("<title>Contents | ContentQuery x Next.js</title>");
    expect(html).not.toContain("A workspace is a shared home");
  });

  test("generates nested catch-all routes and their page metadata", async () => {
    const html = await readFile(path.join(root, "out/docs/reference/shortcuts.html"), "utf8");
    const navigation = html.match(/<nav class="page-navigation"[\s\S]*?<\/nav>/)?.[0];
    expect(html).toContain("<title>Shortcuts | ContentQuery x Next.js</title>");
    expect(html).toContain('id="moving-around"');
    expect(html).toContain('content="Keep your hands on the keyboard."');
    expect(navigation).toContain('href="/docs/sharing-a-workspace"');
    expect(navigation).not.toContain('rel="next"');
  });

  test("exports the custom missing-guide page", async () => {
    const html = await readFile(path.join(root, "out/404.html"), "utf8");
    expect(html).toContain("Guide not found.");
    expect(html).toContain("Back to the guides");
  });

  test("rejects invalid content before Next.js compilation", async () => {
    await cp(path.join(appRoot, "content"), path.join(root, "content"), { recursive: true });
    await cp(
      path.join(appRoot, "content-query.config.ts"),
      path.join(root, "content-query.config.ts"),
    );
    await writeFile(
      path.join(root, "content/guides/getting-started.md"),
      "---\ntitle: false\n---\n",
    );
    await expect(
      execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'const {default: config} = await import("./next.config.mjs"); await config("phase-production-build");',
        ],
        { cwd: root },
      ),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("validation-error") });
  });
});
