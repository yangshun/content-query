import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { createFixture, removeFixture, serverOrigin, startProcess, stopProcess } from "./fixture";

const guideIds = [
  "getting-started",
  "organizing-projects",
  "sharing-a-workspace",
  "reference/shortcuts",
];

describe("Angular native SSR production example", () => {
  let root: string;
  let server: ReturnType<typeof startProcess> | undefined;
  let origin: string;

  beforeAll(async () => {
    root = await createFixture();
    const build = startProcess(root, "vp", ["run", "build"]);
    expect(await build.closed, build.output()).toBe(0);
    // The built server and browser assets must work without authored content or generated sources.
    await rm(path.join(root, "content"), { recursive: true });
    await rm(path.join(root, "content-query.config.ts"));
    await rm(path.join(root, ".content-query"), { recursive: true });
    server = startProcess(root, "node", ["dist/angular/server/server.mjs"], {
      PORT: "0",
      NODE_ENV: "production",
    });
    origin = await serverOrigin(server);
  }, 90_000);

  afterAll(async () => {
    await stopProcess(server);
    await removeFixture(root);
  });

  test("serves an ordered metadata-only index and distinct sidebar query", async () => {
    const response = await fetch(origin);
    const html = await response.text();
    expect(response.status).toBe(200);
    const positions = guideIds.map((id) => html.indexOf(`href="/docs/${id}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(html).toContain("Make a workspace and give your first project a home.");
    expect(html).not.toContain("Start with a workspace");
    expect(html).toContain('class="guide-row"');
    expect(html).not.toContain('class="guide-nav"');
    const guides = await fetch(`${origin}/api/guides`).then((result) => result.json());
    expect(guides.map((guide: { id: string }) => guide.id)).toEqual(guideIds);
    expect(Object.keys(guides[0]).sort()).toEqual(["description", "id", "title"]);
    const navigation = await fetch(`${origin}/api/navigation`).then((result) => result.json());
    expect(Object.keys(navigation[0]).sort()).toEqual(["id", "title"]);
  });

  test.each(guideIds)("server-renders %s with Markdown, metadata, and neighbors", async (id) => {
    const response = await fetch(`${origin}/docs/${id}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("<h2");
    expect(html).toContain('class="docs-layout"');
    expect(html).toContain('class="guide-main"');
    expect(html).toContain(`href="/docs/${id}#main-content"`);
    expect(html).toContain('class="prose"');
    const sidebar = html.match(/<nav\b[^>]*class="guide-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(sidebar).toBeDefined();
    for (const guideId of guideIds) {
      expect(sidebar).toContain(`href="/docs/${guideId}"`);
    }
    expect(sidebar).toContain('aria-current="page"');
    const title = html.match(/<h1[^>]*>([^<]+)/)?.[1];
    expect(html).toContain(`<title>${title} | ContentQuery x Angular</title>`);
    expect(html).toContain('name="description"');
    const navigation = html.match(/<nav\b[^>]*class="page-navigation"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(navigation).toBeDefined();
    const index = guideIds.indexOf(id);
    for (const [direction, neighbor] of [
      ["prev", guideIds[index - 1]],
      ["next", guideIds[index + 1]],
    ] as const) {
      if (neighbor) {
        expect(navigation).toContain(`href="/docs/${neighbor}"`);
        expect(navigation).toContain(`rel="${direction}"`);
      } else {
        expect(navigation).not.toContain(`rel="${direction}"`);
      }
    }
    if (id === "reference/shortcuts") {
      expect(html).toContain('id="moving-around"');
    }
    const article = await fetch(`${origin}/api/guide?id=${encodeURIComponent(id)}`).then((result) =>
      result.json(),
    );
    expect(article.guide.id).toBe(id);
    expect(article.guide.html).toContain("<h2");
    // Angular's native HTTP transfer cache carries loader data into hydration.
    expect(html).toContain('id="ng-state"');
  });

  test("returns 404 for missing guides through both SSR and the API", async () => {
    const response = await fetch(`${origin}/docs/missing/`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Guide not found.");
    expect((await fetch(`${origin}/api/guide?id=missing`)).status).toBe(404);
  });

  test("keeps the ContentQuery runtime and authored content out of browser bundles", async () => {
    const directory = path.join(root, "dist/angular/browser");
    for (const file of await readdir(directory)) {
      if (file.endsWith(".js")) {
        const code = await readFile(path.join(directory, file), "utf8");
        expect(code).not.toContain("createArtifactRuntime");
        expect(code).not.toContain("Start with a workspace");
        expect(code).not.toContain("node:fs");
      }
    }
  });
});
