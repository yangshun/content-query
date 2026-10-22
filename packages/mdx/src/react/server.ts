import { randomUUID } from "node:crypto";
import { createContext, createElement, useContext, type ElementType } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { stringify } from "devalue";
import type { MDXComponents } from "mdx/types.js";
import type { HydrationStrategy, MdxAssets, MdxModule } from "../types.ts";
import type { MdxClientReference } from "../types.ts";
import { registerDocument } from "./documents.ts";

/** Primes SSR rendering and returns only the selected serializable browser reference to a loader. */
export function prepareMdxDocument(
  reference: MdxClientReference,
  module: MdxModule,
): MdxClientReference {
  registerDocument(reference, module);
  return { url: reference.url, css: [...reference.css] };
}

type RenderContext = { assets: MdxAssets; prefix: string; next: number; styles: Set<string> };
const context = createContext<RenderContext | undefined>(undefined);

/** Options for the buffered standalone renderer; ordinary React components bypass this renderer. */
export type RenderMdxOptions = {
  assets: MdxAssets;
  props?: Record<string, unknown>;
  components?: MDXComponents;
  identifierPrefix?: string;
};

/** Renders a compiled island boundary as an independently hydratable React root. */
export function Island({
  __cq_component: Component,
  __cq_id: id,
  __cq_strategy: strategy,
  __cq_source: source,
  __cq_inline: inline = false,
  ...props
}: Record<string, unknown> & {
  __cq_component?: ElementType;
  __cq_id: string;
  __cq_strategy: HydrationStrategy;
  __cq_source: string;
  __cq_inline?: boolean;
}) {
  const current = useContext(context);
  if (!current) {
    throw new Error("Compiled islands must be rendered through renderMdx().");
  }
  const entry = current.assets.island(id);
  for (const style of entry.css) {
    current.styles.add(style);
  }
  const prefix = `${current.prefix}${current.next++}-`;
  try {
    const encoded = stringify(props);
    const html =
      strategy === "only"
        ? ""
        : renderToString(createElement(Component!, props), { identifierPrefix: prefix });
    return createElement(inline ? "span" : "div", {
      "data-cq-island": id,
      "data-cq-entry": JSON.stringify(entry),
      "data-cq-strategy": strategy,
      "data-cq-prefix": prefix,
      "data-cq-props": encoded,
      dangerouslySetInnerHTML: { __html: html },
    });
  } catch (cause) {
    throw new Error(
      `Could not render MDX island at ${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Buffers static document HTML while independently server-rendering its marked React widgets. */
export function renderMdxModule(
  module: MdxModule,
  options: RenderMdxOptions,
  styles: readonly string[] = [],
) {
  const state: RenderContext = {
    assets: options.assets,
    prefix: options.identifierPrefix ?? `cq-${randomUUID()}-`,
    next: 0,
    styles: new Set(styles),
  };
  const html = renderToStaticMarkup(
    createElement(
      context.Provider,
      { value: state },
      createElement(module.default, { ...options.props, components: options.components }),
    ),
  );
  return {
    html,
    headings: module.headings.map((heading) => ({ ...heading })),
    styles: [...state.styles],
  };
}
