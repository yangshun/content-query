import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contentQuery } from "content-query/vite";
import { createServer, type ViteDevServer } from "vite-plus";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import type { CloudContext } from "void";
import type { NavigationShared } from "../middleware/01.docs";
import type { Props as HomeProps } from "../pages/index.server";
import type { Props as GuideProps } from "../pages/docs/[...slug].server";
import Homepage from "../pages/index";
import {
  collectionExampleCode,
  computedExampleCode,
  exampleAuthors,
  examplePosts,
  featureExampleIds,
  queryExampleCode,
  queryExamplePosts,
  queryExampleType,
  relationshipExampleCode,
  relationshipQueryCode,
  sourceExamples,
  sourceToDataExample,
  type QueryExampleOptions,
} from "../src/feature-example-data";

const execFileAsync = promisify(execFile);
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const guideIds = [
  "introduction",
  "quick-start",
  "how-it-works",
  "collections-and-schemas",
  "sources-and-loaders",
  "computed-fields",
  "relationships",
  "querying-content",
  "rendering-content",
  "integrations/vite",
  "integrations/next",
  "integrations/frameworks",
  "integrations/standalone",
  "reference/configuration",
  "reference/collections-and-loaders",
  "reference/queries-and-operators",
  "reference/runtime",
  "reference/cli",
  "reference/errors",
];
const sectionIds = [
  "getting-started",
  "defining-content",
  "querying",
  "rendering",
  "integrations",
  "reference",
];

/** Supplies the request parameter and 404 response used by the guide loader. */
function requestContext(id = "") {
  return {
    req: { param: () => id },
    notFound: () => new Response("Not Found", { status: 404 }),
  } as unknown as CloudContext;
}

describe("ContentQuery website guide routes with the generated backend", () => {
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
    workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-website-test-")));
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

  test("renders a dedicated homepage with all nine examples and real Markdown output", async () => {
    const renderSpy = vi.spyOn(content, "render");
    const props = (await homeRoute.loader(requestContext())) as HomeProps;

    expect(props).not.toHaveProperty("guide");
    expect(props.renderedExample.html).toContain('<h2 id="hello-world">Hello, world</h2>');
    expect(props.renderedExample.html).toContain("--shiki-dark");
    expect(props.renderedExample.headings).toEqual([
      { depth: 2, slug: "hello-world", text: "Hello, world" },
    ]);
    expect(renderSpy).toHaveBeenCalledExactlyOnceWith("examples", "hello-world");
    const html = renderToStaticMarkup(createElement(Homepage, props));
    for (const id of featureExampleIds) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html.indexOf('id="source-to-data"')).toBeLessThan(html.indexOf('id="query-syntax"'));
    expect(html.indexOf('id="query-syntax"')).toBeLessThan(html.indexOf('id="typed-queries"'));
    expect(html).toContain("From source to data");
    expect(html).toContain("Flexible type-safe query syntax");
    expect(html).toContain("Fluent");
    expect(html).toContain("Object");
    expect(html).toContain('aria-label="Query operations"');
    expect(html).toContain("Select title only");
    expect(html).toContain('aria-label="Query sample posts"');
    expect(html).toContain('aria-label="Typed query sample posts"');
    expect(html).toContain("Try a misspelled field");
    expect(html).toContain('<h2 id="hello-world">Hello, world</h2>');
    expect(html).toContain('href="/docs/introduction"');
    expect(html).toContain('href="/docs/quick-start"');
    expect(html).toContain("Play demo");
    expect(html).toContain("Next.js development");
    expect(html).toContain("Exclude drafts");
    expect(html).toContain('class="home-flow-diagram"');
    expect(html).toContain("Pause animation");
    expect(html).not.toContain("A content layer for your application");
  });

  test.each(["/", "/docs/reference/cli"])(
    "loads ordered section metadata independently of article data on %s",
    async (requestPath) => {
      const set = vi.fn();
      const next = vi.fn().mockResolvedValue(undefined);
      const render = vi.spyOn(content, "render");
      await navigationMiddleware(
        {
          req: { path: requestPath },
          get: () => ({ other: "preserved" }),
          set,
        } as unknown as CloudContext,
        next,
      );
      expect(set).toHaveBeenCalledOnce();
      expect(set.mock.calls[0]![0]).toBe("shared");
      const shared = set.mock.calls[0]![1] as NavigationShared & { other: string };
      expect(shared.other).toBe("preserved");
      expect(shared.isDocsPage).toBe(requestPath.startsWith("/docs/"));
      expect(shared.guideNavigation.map((guide) => guide.id)).toEqual(guideIds);
      expect([...new Set(shared.guideNavigation.map((guide) => guide.section))]).toEqual(
        sectionIds,
      );
      for (const guide of shared.guideNavigation) {
        expect(Object.keys(guide).sort()).toEqual(["id", "section", "title"]);
      }
      expect(render).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    },
  );

  test.each(guideIds)("renders only %s with headings and adjacent guides", async (id) => {
    const renderSpy = vi.spyOn(content, "render");
    const props = (await guideRoute.loader(requestContext(id))) as GuideProps;
    const currentIndex = guideIds.indexOf(id);

    expect(props.guide.id).toBe(id);
    expect(props).not.toHaveProperty("guides");
    expect(props.previous?.id ?? null).toBe(guideIds[currentIndex - 1] ?? null);
    expect(props.next?.id ?? null).toBe(guideIds[currentIndex + 1] ?? null);
    expect(renderSpy).toHaveBeenCalledExactlyOnceWith("guides", id);
    expect(props.headings.length).toBeGreaterThan(0);
    for (const heading of props.headings) {
      expect(props.guide.html).toContain(`id="${heading.slug}"`);
    }
  });

  test("every internal documentation link resolves to a page and heading", async () => {
    const documents = new Map(
      await Promise.all(
        guideIds.map(async (id) => {
          const rendered = await content.render("guides", id);
          const pathname = `/docs/${id}`;
          return [pathname, rendered] as const;
        }),
      ),
    );
    for (const [pathname, document] of documents) {
      for (const match of document.html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
        const target = new URL(match[1]!, `https://content-query.test${pathname}`);
        if (target.origin !== "https://content-query.test") {
          continue;
        }
        expect(documents.has(target.pathname), `${pathname} links to ${target.pathname}`).toBe(
          true,
        );
        if (target.hash) {
          expect(documents.get(target.pathname)!.headings.map((heading) => heading.slug)).toContain(
            decodeURIComponent(target.hash.slice(1)),
          );
        }
      }
    }
  });

  test("runs the published quick-start code through preparation and rendering", async () => {
    const body = (await content.readBody("guides", "quick-start"))!;
    const blocks = new Map(
      [...body.matchAll(/^```(ts|md|js)\n([\s\S]*?)^```/gm)].map((match) => [match[1]!, match[2]!]),
    );
    expect([...blocks.keys()]).toEqual(["ts", "md", "js"]);
    const quickStartRoot = path.join(workspace, "quick-start");
    await mkdir(path.join(quickStartRoot, "content/posts"), { recursive: true });
    await symlink(
      path.join(appRoot, "node_modules"),
      path.join(quickStartRoot, "node_modules"),
      "dir",
    );
    await writeFile(path.join(quickStartRoot, "package.json"), '{"type":"module"}\n');
    await writeFile(path.join(quickStartRoot, "content-query.config.ts"), blocks.get("ts")!);
    await writeFile(path.join(quickStartRoot, "content/posts/hello.md"), blocks.get("md")!);
    await writeFile(path.join(quickStartRoot, "render.mjs"), blocks.get("js")!);
    await execFileAsync(
      process.execPath,
      [path.join(appRoot, "node_modules/content-query/dist/cli.mjs"), "build"],
      { cwd: quickStartRoot },
    );
    await execFileAsync(process.execPath, ["render.mjs"], { cwd: quickStartRoot });
    const html = await readFile(path.join(quickStartRoot, "post.html"), "utf8");
    expect(html).toContain('<h2 id="my-first-post">My first post</h2>');
    expect(html).toContain("Content starts here.");
  });

  test("runs the Next.js guide configurations and type-checks its Server Component", async () => {
    const quickStart = (await content.readBody("guides", "quick-start"))!;
    const guide = (await content.readBody("guides", "integrations/next"))!;
    const exampleRoot = path.join(workspace, "next-guide");
    await mkdir(path.join(exampleRoot, "content/posts"), { recursive: true });
    await mkdir(path.join(exampleRoot, "app"));
    await symlink(
      path.join(appRoot, "../examples/next/node_modules"),
      path.join(exampleRoot, "node_modules"),
      "dir",
    );
    await writeFile(path.join(exampleRoot, "package.json"), '{"type":"module"}\n');
    await writeFile(
      path.join(exampleRoot, "content-query.config.ts"),
      quickStart.match(/^```ts\n([\s\S]*?)^```/m)![1]!,
    );
    await writeFile(
      path.join(exampleRoot, "content/posts/hello.md"),
      quickStart.match(/^```md\n([\s\S]*?)^```/m)![1]!,
    );
    await writeFile(
      path.join(exampleRoot, "verify.mjs"),
      `import assert from "node:assert/strict";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import configure from "./next.config.mjs";
const config = await configure(PHASE_PRODUCTION_BUILD, { defaultConfig: {} });
assert.equal(config.trailingSlash, true);
const { content } = await import("./.content-query/server.js");
assert.deepEqual(await content.query("posts").select("id", "title").all(), [
  { id: "hello", title: "Hello ContentQuery" },
]);
`,
    );
    for (const match of guide.matchAll(/^```js\n([\s\S]*?)^```/gm)) {
      await writeFile(path.join(exampleRoot, "next.config.mjs"), match[1]!);
      await execFileAsync(process.execPath, ["verify.mjs"], { cwd: exampleRoot });
    }
    await writeFile(
      path.join(exampleRoot, "app/page.tsx"),
      guide.match(/^```tsx\n([\s\S]*?)^```/m)![1]!,
    );
    await execFileAsync(
      process.execPath,
      [
        path.join(appRoot, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--target",
        "es2022",
        "--jsx",
        "react-jsx",
        "--allowImportingTsExtensions",
        "app/page.tsx",
      ],
      { cwd: exampleRoot },
    );
  }, 20_000);

  test("executes the source-to-data example through its displayed schema and query", async () => {
    const exampleRoot = path.join(workspace, "source-to-data");
    await mkdir(path.join(exampleRoot, "content/posts"), { recursive: true });
    await symlink(
      path.join(appRoot, "node_modules"),
      path.join(exampleRoot, "node_modules"),
      "dir",
    );
    await writeFile(path.join(exampleRoot, "package.json"), '{"type":"module"}\n');
    await writeFile(
      path.join(exampleRoot, "content/posts", sourceToDataExample.filename),
      sourceToDataExample.source,
    );
    await writeFile(
      path.join(exampleRoot, "content-query.config.ts"),
      `import { defineCollection } from "content-query";
import { z } from "zod";
${sourceToDataExample.schema}
`,
    );
    const cliPath = path.join(appRoot, "node_modules/content-query/dist/cli.mjs");
    await execFileAsync(process.execPath, [cliPath, "build"], { cwd: exampleRoot });
    await writeFile(
      path.join(exampleRoot, "verify.mjs"),
      `import assert from "node:assert/strict";
import { content } from "./.content-query/server.js";
${sourceToDataExample.query}
assert.deepEqual(posts, ${JSON.stringify(sourceToDataExample.data)});
`,
    );
    await execFileAsync(process.execPath, ["verify.mjs"], { cwd: exampleRoot });
  }, 20_000);

  test("executes homepage sources, computed fields, relationships, and both query syntaxes", async () => {
    const exampleRoot = path.join(workspace, "homepage-examples");
    await mkdir(path.join(exampleRoot, "content/posts"), { recursive: true });
    await mkdir(path.join(exampleRoot, "content/authors"), { recursive: true });
    await symlink(
      path.join(appRoot, "node_modules"),
      path.join(exampleRoot, "node_modules"),
      "dir",
    );
    await writeFile(path.join(exampleRoot, "package.json"), '{"type":"module"}\n');
    for (const post of examplePosts) {
      await writeFile(
        path.join(exampleRoot, `content/posts/${post.id}.md`),
        `---\ntitle: ${JSON.stringify(post.title)}\ndraft: ${post.draft}\nauthorId: ${post.authorId}\n---\n\n${"word ".repeat(600).trim()}\n`,
      );
    }
    for (const author of exampleAuthors) {
      await writeFile(
        path.join(exampleRoot, `content/authors/${author.id}.json`),
        JSON.stringify({ name: author.name }),
      );
    }
    const formatCollections: string[] = [];
    for (const source of sourceExamples) {
      const directory = `./formats/${source.format}`;
      await mkdir(path.join(exampleRoot, directory), { recursive: true });
      await writeFile(path.join(exampleRoot, directory, source.filename), source.code);
      formatCollections.push(
        `${source.format}: ${collectionExampleCode
          .replace(
            'source: "./content/posts"',
            `source: { type: "${source.format}", directory: "${directory}" }`,
          )
          .replace(/;$/, "")}`,
      );
    }
    const postCollection = collectionExampleCode.replace(
      /\n\}\);$/,
      `\n${computedExampleCode},\n${relationshipExampleCode}\n});`,
    );
    await writeFile(
      path.join(exampleRoot, "content-query.config.ts"),
      `
import { defineCollection } from "content-query";
import { z } from "zod";
const posts = ${postCollection}
const authors = defineCollection({ source: { type: "json", directory: "./content/authors" }, schema: z.object({ name: z.string() }) });
export const collections = { posts, authors, ${formatCollections.join(",\n")} };
`,
    );
    const cliPath = path.join(appRoot, "node_modules/content-query/dist/cli.mjs");
    await execFileAsync(process.execPath, [cliPath, "build"], { cwd: exampleRoot });

    const combinations: QueryExampleOptions[] = [];
    for (const excludeDrafts of [false, true]) {
      for (const sort of ["id-asc", "title-asc", "title-desc"] as const) {
        for (const limit of [null, 2, 3]) {
          for (const fields of ["title", "title-and-draft"] as const) {
            combinations.push({ excludeDrafts, sort, limit, fields });
          }
        }
      }
    }
    const queryChecks = combinations.flatMap((options, index) =>
      (["fluent", "prisma-style"] as const).map((syntax) => {
        const resultName = `result${index}${syntax === "fluent" ? "Fluent" : "Object"}`;
        return `
const ${resultName} = await (async () => {
${queryExampleCode(options, syntax)}
return posts;
})();
assert.deepEqual(${resultName}, ${JSON.stringify(queryExamplePosts(options))});
`;
      }),
    );
    const sourceChecks = sourceExamples.map(
      (source) =>
        `assert.deepEqual(await content.query("${source.format}").select("id", "title", "draft", "authorId").first(), ${JSON.stringify(examplePosts[0])});`,
    );
    await writeFile(
      path.join(exampleRoot, "verify.mjs"),
      `
import assert from "node:assert/strict";
import { content } from "./.content-query/server.js";
import { eq } from "content-query/query";
${queryChecks.join("\n")}
${sourceChecks.join("\n")}
assert.deepEqual(await content.query("posts").where((fields) => eq(fields.id, "hello-world")).select("readingMinutes").first(), { readingMinutes: 3 });
${relationshipQueryCode}
assert.deepEqual(posts, ${JSON.stringify(examplePosts.filter((post) => post.authorId === "ada").map((post) => ({ title: post.title, author: { name: "Ada Lovelace" } })))});
`,
    );
    await execFileAsync(process.execPath, ["verify.mjs"], { cwd: exampleRoot });

    const typeChecks = (["title", "title-and-draft"] as const).flatMap((fields, index) =>
      (["fluent", "prisma-style"] as const).map((syntax) => {
        const options: QueryExampleOptions = {
          fields,
          excludeDrafts: false,
          sort: "id-asc",
          limit: null,
        };
        return `
async function check${index}${syntax === "fluent" ? "Fluent" : "Object"}() {
${queryExampleCode(options, syntax)}
const expected: ${queryExampleType(options)} = posts;
const actual: typeof posts = expected;
// @ts-expect-error Nonexistent fields are absent from the result type.
posts[0]?.drafft;
${fields === "title" ? "// @ts-expect-error Unselected fields are absent from the result type.\nposts[0]?.draft;" : "const draft: boolean | undefined = posts[0]?.draft;\nvoid draft;"}
return actual;
}
`;
      }),
    );
    await writeFile(
      path.join(exampleRoot, "verify-types.ts"),
      `
import { content } from "./.content-query/server.js";
${typeChecks.join("\n")}
// @ts-expect-error The typed-query example deliberately misspells this field.
content.query("posts").select("title", "drafft");
// @ts-expect-error Object selection rejects the same misspelled field.
content.findMany("posts", { select: { title: true, drafft: true } });
`,
    );
    await execFileAsync(
      process.execPath,
      [
        path.join(appRoot, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--target",
        "es2022",
        "--allowImportingTsExtensions",
        "verify-types.ts",
      ],
      { cwd: exampleRoot },
    );
    await writeFile(
      path.join(exampleRoot, "content/posts/invalid.md"),
      '---\ntitle: Invalid\ndraft: "yes"\nauthorId: ada\n---\n',
    );
    await expect(
      execFileAsync(process.execPath, [cliPath, "build"], { cwd: exampleRoot }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /\[content-query:validation-error\] posts invalid .*expected boolean, received string/,
      ),
    });
  }, 20_000);

  test("returns 404 for a missing guide without rendering it", async () => {
    const renderSpy = vi.spyOn(content, "render");
    const response = (await guideRoute.loader(requestContext("missing-guide"))) as Response;

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    expect(renderSpy).not.toHaveBeenCalled();
  });

  test("discovers nested new pages without changing the dedicated homepage", async () => {
    expect(await guideRoute.getPrerenderPaths()).toEqual(guideIds.map((slug) => ({ slug })));
    const directory = path.join(fixtureRoot, "content/guides/getting-started");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "shortcuts.md"),
      "---\ntitle: Shortcuts\ndescription: Common tasks.\nsection: getting-started\norder: 0\n---\n## Moving around\n",
    );

    await vi.waitFor(
      async () => {
        expect(await guideRoute.getPrerenderPaths()).toEqual(
          ["getting-started/shortcuts", ...guideIds].map((slug) => ({ slug })),
        );
        const homepage = (await homeRoute.loader(requestContext())) as HomeProps;
        expect(homepage).not.toHaveProperty("guide");
        expect(homepage.renderedExample.headings[0]?.slug).toBe("hello-world");
        const guide = (await guideRoute.loader(
          requestContext("getting-started/shortcuts"),
        )) as GuideProps;
        expect(guide.previous).toBeNull();
        expect(guide.next?.id).toBe("introduction");
      },
      { timeout: 5_000 },
    );
  });
});
