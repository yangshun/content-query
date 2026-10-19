import { useMemo, type CSSProperties } from "react";
import { createHighlighterCoreSync, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import html from "shiki/langs/html.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import toml from "shiki/langs/toml.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";

export type CodeLanguage =
  | "typescript"
  | "markdown"
  | "json"
  | "yaml"
  | "toml"
  | "html"
  | "shellscript";

// Load only the grammars used by the examples, with the same theme as the docs.
const highlighter = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  themes: [githubDark],
  langs: [typescript, markdown, json, yaml, toml, html, shellscript],
});

function tokenStyle(token: ThemedToken): CSSProperties {
  const fontStyle = token.fontStyle ?? 0;
  return {
    color: token.color,
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? "bold" : undefined,
    textDecoration: fontStyle & 4 ? "underline" : undefined,
  };
}

export function HighlightedCode({
  code,
  language,
  highlight = [],
  invalid = false,
}: {
  code: string;
  language: CodeLanguage;
  highlight?: readonly string[];
  invalid?: boolean;
}) {
  const lines = useMemo(
    () => highlighter.codeToTokens(code, { lang: language, theme: "github-dark" }).tokens,
    [code, language],
  );
  return (
    <code className={`language-${language}`}>
      {lines.map((line, lineIndex) => (
        <span
          className="example-code-line"
          data-highlighted={highlight.some((part) =>
            line
              .map((token) => token.content)
              .join("")
              .includes(part),
          )}
          data-invalid={invalid}
          key={lineIndex}
        >
          {line.map((token) => (
            <span style={tokenStyle(token)} key={token.offset}>
              {token.content}
            </span>
          ))}
          {lineIndex < lines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </code>
  );
}
