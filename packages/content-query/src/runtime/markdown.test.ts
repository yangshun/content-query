import { describe, expect, test } from "vite-plus/test";
import { renderMarkdown } from "./markdown.ts";

describe("Markdown rendering", () => {
  test("isolates heading slugs, reference links, and bodies across concurrent documents", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, async (_, index) =>
        renderMarkdown(
          `# Repeated\n\n## Repeated\n\nArticle ${index}. [Reference][target] https://example.com/${index}\n\n[target]: /article-${index}\n`,
        ),
      ),
    );
    for (const [index, result] of results.entries()) {
      expect(result.headings.map(({ slug }) => slug)).toEqual(["repeated", "repeated-1"]);
      expect(result.html).toContain(`href="/article-${index}"`);
      expect(result.html).toContain(`href="https://example.com/${index}"`);
      expect(result.html).toContain(`Article ${index}.`);
    }
  });

  test("retains syntax highlighting and escapes unrecognized fenced languages", async () => {
    const [javascript, unknown] = await Promise.all([
      renderMarkdown("```js\nconst value = 1;\n```"),
      renderMarkdown('```unknown-language\n<script>alert("example")</script>\n```'),
    ]);
    expect(javascript.html).toContain('class="language-js"');
    expect(javascript.html).toContain("shiki");
    expect(unknown.html).toContain('class="language-text"');
    expect(unknown.html).toContain("&#x3C;script>");
    expect(unknown.html).not.toContain("<script>");
  });
});
