import { createElement, useId } from "react";
import { describe, expect, test } from "vite-plus/test";
import { renderToString } from "react-dom/server";
import { parse } from "devalue";
import { Island, renderMdxModule } from "./server.ts";
import { createMdxAssets } from "../assets.ts";
import type { MdxModule } from "../types.ts";

const assets = createMdxAssets({
  version: 1,
  documents: {},
  islands: { field: { url: "/field.js", css: ["/field.css"] } },
  assets: [],
});

/** Uses an SSR-generated ID to catch accidental coupling to the document's outer React render. */
function Field({ label }: { label?: string }) {
  const id = useId();
  return createElement("label", { htmlFor: id }, label, createElement("input", { id }));
}

/** Builds a compiled-like boundary while retaining ordinary widget props. */
function field(props: Record<string, unknown> = {}) {
  return createElement(Island, {
    __cq_id: "field",
    __cq_strategy: "visible",
    __cq_component: Field,
    __cq_source: "test.mdx:2:1",
    ...props,
  });
}

describe("standalone island server renderer", () => {
  test("isolates instance IDs, serializes data, and deduplicates styles", () => {
    const module: MdxModule = {
      default: () =>
        createElement(
          "article",
          null,
          field({ label: "One", date: new Date("2026-01-01") }),
          field({ label: "Two" }),
        ),
      headings: [{ depth: 1, slug: "one", text: "One" }],
    };
    const rendered = renderMdxModule(module, { assets, identifierPrefix: "test-" }, [
      "/static.css",
      "/field.css",
    ]);
    expect(rendered.styles).toEqual(["/static.css", "/field.css"]);
    expect(rendered.html).toContain('data-cq-prefix="test-0-"');
    expect(rendered.html).toContain('data-cq-prefix="test-1-"');
    expect(rendered.html).toContain('id="_test-0-R_0_"');
    const encoded = rendered.html
      .match(/data-cq-props="([^"]+)"/)![1]!
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");
    expect(parse(encoded)).toMatchObject({ label: "One", date: new Date("2026-01-01") });
    rendered.headings[0]!.text = "Changed";
    expect(module.headings[0]!.text).toBe("One");
  });
  test("skips browser-only component evaluation and accepts text children", () => {
    const module: MdxModule = {
      default: () =>
        field({
          __cq_strategy: "only",
          __cq_component: () => {
            throw new Error("browser-only");
          },
          children: "Text",
        }),
      headings: [],
    };
    const result = renderMdxModule(module, { assets });
    expect(result.html).toContain('data-cq-strategy="only"');
    expect(result.html).not.toContain("browser-only");
  });
  test("keeps inline roots inside valid paragraph markup without serializing internal flags", () => {
    const module: MdxModule = {
      default: () =>
        createElement(
          "p",
          null,
          "Before ",
          field({ __cq_inline: true, label: "Inline" }),
          " after.",
        ),
      headings: [],
    };
    const { html } = renderMdxModule(module, { assets });
    expect(html).toMatch(/^<p>Before <span data-cq-island=/);
    expect(html).toContain("</span> after.</p>");
    expect(html).not.toContain("__cq_inline");
  });
  test("reports unsupported props and render failures with source context", () => {
    const module: MdxModule = { default: () => field({ callback: () => {} }), headings: [] };
    expect(() => renderMdxModule(module, { assets })).toThrow("test.mdx:2:1");
    const broken: MdxModule = {
      default: () =>
        field({
          __cq_component: () => {
            throw new Error("broken widget");
          },
        }),
      headings: [],
    };
    expect(() => renderMdxModule(broken, { assets })).toThrow("broken widget");
    expect(() => renderToString(field())).toThrow("renderMdx");
  });
});
