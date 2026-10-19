import { cp, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentQuery } from "content-query/vite";
import { createServer, type ViteDevServer } from "vite-plus";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import type { CloudContext } from "void";
import type { Props as HomeProps } from "../pages/index.server";
import type { Props as GuideProps } from "../pages/docs/[...slug].server";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const guideIds = ["getting-started", "organizing-projects", "sharing-a-workspace"];

/** Supplies the request parameter and 404 response used by the guide loader. */
function requestContext(id = "") {
  return {
    req: { param: () => id },
    notFound: () => new Response("Not Found", { status: 404 }),
  } as unknown as CloudContext;
}

describe("ContentQuery basic guide routes with the generated backend", () => {
  let fixtureRoot: string;
  let workspace: string;
  let server: ViteDevServer;
  let content: typeof import("content-query:server").content;
  let homeRoute: typeof import("../pages/index.server");
  let guideRoute: typeof import("../pages/docs/[...slug].server");
  let navigationMiddleware: typeof import("../middleware/01.docs").default;
  let startupQueries: number;
  let startupRenders: number;

  beforeAll(async () => {
    workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-basic-test-")));
    fixtureRoot = path.join(workspace, "app");
    await mkdir(fixtureRoot);
    for (const source of [
      "content",
      "src",
      "pages",
      "middleware",
      "content-query.config.ts",
      "package.json",
    ]) {
      await cp(path.join(appRoot, source), path.join(fixtureRoot, source), { recursive: true });
    }
    await symlink(
      path.join(appRoot, "node_modules"),
      path.join(fixtureRoot, "node_modules"),
      "dir",
    );
    server = await createServer({
      configFile: false,
      root: fixtureRoot,
      plugins: [contentQuery()],
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
    });
    ({ content } = await server.ssrLoadModule("content-query:server"));
    const querySpy = vi.spyOn(content, "query");
    const renderSpy = vi.spyOn(content, "render");
    homeRoute = (await server.ssrLoadModule("/pages/index.server.ts")) as typeof homeRoute;
    guideRoute = (await server.ssrLoadModule(
      "/pages/docs/[...slug].server.ts",
    )) as typeof guideRoute;
    ({ default: navigationMiddleware } = await server.ssrLoadModule("/middleware/01.docs.ts"));
    startupQueries = querySpy.mock.calls.length;
    startupRenders = renderSpy.mock.calls.length;
    vi.restoreAllMocks();
  }, 20_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await server?.close();
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("imports route modules without querying or rendering content", () => {
    expect(startupQueries).toBe(0);
    expect(startupRenders).toBe(0);
  });

  test("returns an ordered metadata-only homepage index without rendering guides", async () => {
    const renderSpy = vi.spyOn(content, "render");
    const props = (await homeRoute.loader(requestContext())) as HomeProps;

    expect(props.guides.map((guide) => guide.id)).toEqual(guideIds);
    expect(props.guides.map((guide) => guide.title)).toEqual([
      "Getting started",
      "Organizing projects",
      "Sharing a workspace",
    ]);
    for (const guide of props.guides) {
      expect(Object.keys(guide).sort()).toEqual(["description", "id", "title"]);
    }
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("loads sidebar metadata in shared middleware independently of article data", async () => {
    const set = vi.fn();
    const next = vi.fn().mockResolvedValue(undefined);
    const render = vi.spyOn(content, "render");
    await navigationMiddleware(
      {
        req: { path: "/docs/getting-started" },
        get: () => ({ other: "preserved" }),
        set,
      } as unknown as CloudContext,
      next,
    );
    expect(set).toHaveBeenCalledWith("shared", {
      other: "preserved",
      guideNavigation: [
        { id: "getting-started", title: "Getting started" },
        { id: "organizing-projects", title: "Organizing projects" },
        { id: "sharing-a-workspace", title: "Sharing a workspace" },
      ],
    });
    expect(render).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    set.mockClear();
    await navigationMiddleware({ req: { path: "/" }, set } as unknown as CloudContext, next);
    expect(set).not.toHaveBeenCalled();
  });

  test.each(guideIds)("renders only %s and supplies its adjacent guides", async (id) => {
    const renderSpy = vi.spyOn(content, "render");
    const props = (await guideRoute.loader(requestContext(id))) as GuideProps;
    const currentIndex = guideIds.indexOf(id);

    expect(props.guide.id).toBe(id);
    expect(props.guide.html).toContain("<h2");
    expect(props.guide.html).toContain("<ul>");
    expect(props).not.toHaveProperty("guides");
    expect(props.previous?.id ?? null).toBe(guideIds[currentIndex - 1] ?? null);
    expect(props.next?.id ?? null).toBe(guideIds[currentIndex + 1] ?? null);
    expect(renderSpy).toHaveBeenCalledExactlyOnceWith("guides", id);

    if (id === "getting-started") {
      expect(props.guide.html).toContain("<ol>");
      expect(props.guide.html).toContain("<pre");
      expect(props.guide.html).toContain("newNoteTemplate");
      expect(props.guide.html).toContain('href="/docs/organizing-projects"');
    }
  });

  test.each(["missing-guide", ""])(
    "returns 404 for '%s' without attempting to render it",
    async (id) => {
      const renderSpy = vi.spyOn(content, "render");
      const response = (await guideRoute.loader(requestContext(id))) as Response;

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
      expect(renderSpy).not.toHaveBeenCalled();
    },
  );

  test("derives prerender parameters from the collection when invoked, including nested new guides", async () => {
    expect(await guideRoute.getPrerenderPaths()).toEqual(guideIds.map((slug) => ({ slug })));
    const directory = path.join(fixtureRoot, "content/guides/reference");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "shortcuts.md"),
      "---\ntitle: Shortcuts\ndescription: Keep your hands on the keyboard.\norder: 0\n---\n## Moving around\n",
    );

    await vi.waitFor(
      async () => {
        expect(await guideRoute.getPrerenderPaths()).toEqual([
          { slug: "reference/shortcuts" },
          ...guideIds.map((slug) => ({ slug })),
        ]);
      },
      { timeout: 5_000 },
    );
  });
});
