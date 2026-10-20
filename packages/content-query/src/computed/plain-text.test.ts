import { describe, expect, test } from "vite-plus/test";
import { plainText } from "./plain-text.ts";

describe("plainText", () => {
  test("extracts Markdown prose, image alternatives, tables, and literal code", () => {
    expect(
      plainText(
        `# Welcome *friend*

Read [the guide](https://example.com) and \`code\`.

![A **small** cat](cat.png)

> A quote

- One
- Two

| Name | Value |
| --- | --- |
| A | B |

\`\`\`text
<example>literal</example>
\`\`\`

<div>Raw <em>HTML</em> &amp; entities.</div>
<!-- omitted -->
<script>also omitted</script>
`,
        "markdown",
      ),
    ).toBe(
      "Welcome friend Read the guide and code. A small cat A quote One Two Name Value A B <example>literal</example> Raw HTML & entities.",
    );
  });

  test("decodes HTML entities and preserves inline adjacency and block boundaries", () => {
    expect(
      plainText(
        `<head><title>Omitted</title></head>
<p>Hello<strong>there</strong> &amp; &#x1f600;.</p>
<div hidden>Hidden <span>nested</span> text</div>
<style>.also-hidden { color: red }</style>
<script>globalThis.executed = true;</script>
<template><div>Template</div></template><noscript>Fallback</noscript>
<div>Next<br>line<img src="logo.svg" alt="&copy; logo"></div>
<hr><p>Last <span>paragraph</span>.</p><!-- comment -->`,
        "html",
      ),
    ).toBe("Hellothere & 😀. Next line © logo Last paragraph.");
  });

  test("handles malformed HTML and images without alternatives", () => {
    expect(
      plainText("<p>First<p>Second<img src='image.png'><div hidden><br>Hidden</div>Third", "html"),
    ).toBe("First Second Third");
  });

  test("keeps literal syntax in text mode while normalizing Unicode whitespace", () => {
    expect(plainText("  <b>literal</b>\u00a0 &amp;\n **text**\t", "text")).toBe(
      "<b>literal</b> &amp; **text**",
    );
  });

  test.each(["markdown", "html", "text"] as const)("normalizes empty %s input", (format) => {
    expect(plainText(" \n\t", format)).toBe("");
  });
});
