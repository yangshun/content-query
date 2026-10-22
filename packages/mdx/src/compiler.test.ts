import { describe, expect, test } from "vite-plus/test";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { analyzeMdx, compileAnalysis, compileMdx } from "./compiler.ts";

describe("compileMdx", () => {
  test.each([
    "export const headings = [];",
    "export const outline = [];\nexport {outline as headings};",
    'export {outline as headings} from "./outline.js";',
    'export {outline as "headings"} from "./outline.js";',
    'export * as headings from "./outline.js";',
    "export const {outline: headings} = {outline: []};",
    "export const [headings = []] = [];",
    "export const [...headings] = [];",
    "export const {...headings} = {};",
    "export function headings() {}",
    "export class headings {}",
  ])("diagnoses a reserved headings export: %s", async (value) => {
    await expect(
      compileMdx({ path: "reserved.mdx", value }, { highlight: false }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('"headings" export'),
      line: expect.any(Number),
      column: 1,
    });
  });
  test("allows a local headings binding without introducing a duplicate declaration", async () => {
    const result = await compileMdx(
      {
        path: "local.mdx",
        value: 'import headings from "./outline.js";\n\n# Title\n\n{headings.length}',
      },
      { highlight: false },
    );
    expect(result.code).not.toContain("export const headings");
    expect(result.headings[0]?.text).toBe("Title");
  });
  test("emits normal ESM, source maps, exports, GFM, headings and highlighting", async () => {
    const result = await compileMdx({
      path: "/source/article.mdx",
      value:
        "---\ntitle: Example\n---\nimport Widget from './widget';\n\nexport const answer = 42;\n\n# Hello **world**\n\n# Hello **world**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst answer = 42;\n```\n\n<Widget />",
    });
    expect(result.code).toMatch(/from ['"]\.\/widget['"]/);
    expect(result.code).toContain("export const answer = 42");
    expect(result.code).toContain('table: "table"');
    expect(result.code).toContain("shiki");
    expect(result.code).not.toMatch(/hydrateRoot|react-dom|content-query-mdx:|__cq_Island/);
    expect(result.headings).toEqual([
      { depth: 1, slug: "hello-world", text: "Hello world" },
      { depth: 1, slug: "hello-world-1", text: "Hello world" },
    ]);
    expect(result.map?.sources).toEqual(["/source/article.mdx"]);
  });
  test("supports author plugins and reuses transformed analysis across targets", async () => {
    let transforms = 0;
    const plugin: Plugin<[], Root> = () => (tree) => {
      transforms++;
      visit(tree, "text", (node) => {
        node.value = node.value.replace("Before", "After");
      });
    };
    const analysis = await analyzeMdx(
      { path: "plugins.mdx", value: "# Before" },
      { remarkPlugins: [plugin] },
    );
    expect((await compileAnalysis(analysis, { highlight: false })).headings[0]?.text).toBe("After");
    expect(
      (await compileAnalysis(analysis, { target: "islands", highlight: false })).headings[0]?.text,
    ).toBe("After");
    expect(transforms).toBe(1);
  });
  test.each(["load", "visible", "idle"])(
    "removes client:%s in React mode and wraps it in island mode",
    async (strategy) => {
      const file = {
        path: "island.mdx",
        value: `import {Widget as Demo} from './widget';\n\n<Demo client:${strategy} count={2} />`,
      };
      const normal = await compileMdx(file, { highlight: false });
      expect(normal.code).not.toContain(`client:${strategy}`);
      expect(normal.code).not.toContain("@content-query/mdx");
      const islands = await compileMdx(file, {
        target: "islands",
        highlight: false,
        resolveIsland: () => ({ id: "widget-key" }),
      });
      expect(islands.code).toContain('from "@content-query/mdx/react/server"');
      expect(islands.code).toContain('__cq_id: "widget-key"');
      expect(islands.islands[0]).toMatchObject({
        source: "./widget",
        imported: "Widget",
        local: "Demo",
        strategy,
      });
    },
  );
  test("keeps browser-only imports out of both server targets", async () => {
    const file = {
      path: "only.mdx",
      value: 'import Browser from "./browser";\n\n<Browser client:only="react" value="hi" />',
    };
    const normal = await compileMdx(file, {
      highlight: false,
      resolveIsland: () => ({ id: "browser", clientOnlyImport: "./browser-boundary" }),
    });
    expect(normal.code).toContain('from "./browser-boundary"');
    expect(normal.code).not.toContain('from "./browser"');
    const islands = await compileMdx(file, {
      highlight: false,
      target: "islands",
      resolveIsland: () => ({ id: "browser" }),
    });
    expect(islands.code).not.toContain('from "./browser"');
    expect(islands.code).not.toContain("__cq_component");
  });
  test("distinguishes inline widget boundaries so text children retain valid paragraph markup", async () => {
    const compiled = await compileMdx(
      {
        path: "inline.mdx",
        value: 'import Widget from "./widget";\n\nBefore <Widget client:load>Text</Widget> after.',
      },
      { target: "islands", highlight: false, resolveIsland: () => ({ id: "inline" }) },
    );
    expect(compiled.code).toContain("__cq_inline: true");
  });
  test("preserves imports used outside a client-only boundary and namespace members", async () => {
    const file = {
      path: "members.mdx",
      value:
        'import * as Widgets from "./widgets";\n\nexport const used = Widgets;\n\n<Widgets.Counter client:only />',
    };
    const result = await compileMdx(file, {
      target: "islands",
      highlight: false,
      resolveIsland: () => ({ id: "counter" }),
    });
    expect(result.code).toContain('import * as Widgets from "./widgets"');
    expect(result.islands[0]?.imported).toBe("Counter");
  });
  test.each([
    ["<Missing client:load />", "explicitly imported"],
    ['import Widget from "./widget";\n\n<Widget client:media />', "supported client directive"],
    ['import Widget from "./widget";\n\n<Widget client:load client:idle />', "exactly one"],
    [
      'import Widget from "./widget";\n\n<Widget client:visible={{rootMargin:"1px"}} />',
      "no options",
    ],
    [
      'import Widget from "./widget";\n\n<Widget client:load><strong>Text</strong></Widget>',
      "data props and text",
    ],
  ])("reports source positions for %s", async (value, message) => {
    await expect(
      compileMdx({ path: "broken.mdx", value }, { highlight: false }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(message),
      line: expect.any(Number),
      column: expect.any(Number),
    });
  });
  test("requires an explicit host resolver for standalone island and client-only targets", async () => {
    await expect(
      compileMdx(
        { path: "resolver.mdx", value: 'import Widget from "./widget";\n\n<Widget client:load />' },
        { target: "islands", highlight: false },
      ),
    ).rejects.toThrow("import resolver");
    await expect(
      compileMdx(
        { path: "resolver.mdx", value: 'import Widget from "./widget";\n\n<Widget client:only />' },
        { highlight: false },
      ),
    ).rejects.toThrow("host integration");
  });
});
