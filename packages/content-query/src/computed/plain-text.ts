import { Parser } from "htmlparser2";
import MarkdownExit from "markdown-exit";

const markdown = new MarkdownExit({ html: true });
const ignoredElements = new Set(["head", "script", "style", "template", "noscript"]);
const blockElements = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** Extracts HTML text and image alternatives without executing markup or retaining hidden code. */
function htmlText(html: string): string {
  const parts: string[] = [];
  let ignoredDepth = 0;
  const parser = new Parser({
    onopentag(name, attributes) {
      if (ignoredDepth || ignoredElements.has(name) || Object.hasOwn(attributes, "hidden")) {
        ignoredDepth++;
        return;
      }
      if (blockElements.has(name)) {
        parts.push(" ");
      }
      if (name === "img" && attributes.alt) {
        parts.push(" ", attributes.alt, " ");
      }
    },
    ontext(text) {
      if (!ignoredDepth) {
        parts.push(text);
      }
    },
    onclosetag(name) {
      if (ignoredDepth) {
        ignoredDepth--;
      } else if (blockElements.has(name)) {
        parts.push(" ");
      }
    },
  });
  parser.end(html);
  return parts.join("");
}

/** Normalizes captured Markdown, HTML, or literal text to whitespace-separated plain text. */
export function plainText(input: string, format: "markdown" | "html" | "text"): string {
  const text =
    format === "text" ? input : htmlText(format === "markdown" ? markdown.render(input) : input);
  return text.replace(/\s+/gu, " ").trim();
}
