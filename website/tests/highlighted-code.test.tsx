import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import { HighlightedCode, type CodeLanguage } from "../src/highlighted-code";

const examples: { language: CodeLanguage; code: string }[] = [
  { language: "typescript", code: 'const posts = await content\n  .query("posts")\n  .all();\n' },
  {
    language: "markdown",
    code: "---\ntitle: Hello, world\ndraft: false\n---\n\n## Hello\n\n```ts\nconst draft = false;\n```",
  },
  { language: "json", code: '{\n  "title": "Hello, world",\n  "draft": false\n}' },
  { language: "yaml", code: 'title: "Hello, world"\ndraft: false' },
  { language: "toml", code: 'title = "Hello, world"\ndraft = false' },
  { language: "html", code: '<article data-title="Hello & world">\n  <h1>Hello</h1>\n</article>' },
  { language: "shellscript", code: 'npx content-query prepare\nprintf "%s\\n" "Hello, world"' },
];

describe("homepage code highlighting", () => {
  test.each(examples)("highlights $language without changing the source", ({ language, code }) => {
    const html = renderToStaticMarkup(createElement(HighlightedCode, { code, language }));
    const escapedSource = renderToStaticMarkup(createElement("code", null, code));

    expect(html.replace(/<[^>]*>/g, "")).toBe(escapedSource.replace(/<[^>]*>/g, ""));
    expect(html).toContain(`class="language-${language}"`);
    expect(new Set(html.match(/color:#[\da-f]{6,8}/gi)).size).toBeGreaterThan(1);
  });

  test("preserves operation and error highlights across syntax tokens", () => {
    const html = renderToStaticMarkup(
      createElement(HighlightedCode, {
        code: 'content\n  .query("posts")\n  .select("title", "drafft");',
        language: "typescript",
        highlight: [".select("],
        invalid: true,
      }),
    );

    expect(html.match(/data-highlighted="true"/g)).toHaveLength(1);
    expect(html).toContain('data-highlighted="true" data-invalid="true"');
    expect(html).toContain("drafft");
  });

  test("renders HTML-like content as escaped code", () => {
    const html = renderToStaticMarkup(
      createElement(HighlightedCode, {
        code: 'const markup = "<script>alert(1)</script>";',
        language: "typescript",
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
