import MarkdownExit from "markdown-exit";
import GithubSlugger from "github-slugger";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { bundledLanguages, createHighlighter } from "shiki";
import type { ContentRenderResult } from "./types.ts";

let highlighter: ReturnType<typeof createHighlighter> | undefined;

/** Compiles captured Markdown using only library-owned, portable processing code. */
export async function renderMarkdown(body: string): Promise<ContentRenderResult> {
  const markdown = new MarkdownExit({ html: true, linkify: true });
  const slugger = new GithubSlugger();
  const tokens = markdown.parse(body, {});
  const headings: ContentRenderResult["headings"] = [];
  // Headings carry IDs only; permalink anchors and other presentation are application-owned.
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type !== "heading_open") {
      continue;
    }
    const inline = tokens[index + 1];
    const text = (inline?.children ?? [])
      .map((child) =>
        child.type === "text" || child.type === "code_inline" || child.type === "image"
          ? child.content
          : child.type === "softbreak" || child.type === "hardbreak"
            ? " "
            : "",
      )
      .join("");
    const slug = slugger.slug(text);
    token.attrSet("id", slug);
    headings.push({ depth: Number(token.tag.slice(1)), slug, text });
  }
  markdown.renderer.rules.fence = async (allTokens, index) => {
    const token = allTokens[index]!;
    const requested = token.info.trim().split(/\s+/)[0] || "text";
    const language = Object.hasOwn(bundledLanguages, requested)
      ? (requested as keyof typeof bundledLanguages)
      : "text";
    highlighter ??= createHighlighter({
      engine: createJavaScriptRegexEngine(),
      themes: ["github-light", "github-dark"],
      langs: [],
    });
    const instance = await highlighter;
    if (language !== "text" && !instance.getLoadedLanguages().includes(language)) {
      await instance.loadLanguage(language);
    }
    const html = instance.codeToHtml(token.content, {
      lang: language,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: "light",
    });
    return `<div class="language-${language}">${html}</div>\n`;
  };
  const html = await markdown.renderer.renderAsync(tokens, markdown.options, {});
  return { html, headings };
}
