"use client";

import {
  Fragment,
  Suspense,
  createElement,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import type { MDXProps } from "mdx/types.js";
import { mountIslands, type MountIslandsOptions } from "./client.ts";
import { resolveDocument } from "./react/documents.ts";
import type { MdxClientReference } from "./types.ts";

/** Props for a selected MDX document that participates in the surrounding React tree. */
export type MdxDocumentProps = MDXProps & {
  reference: MdxClientReference;
  fallback?: ReactNode;
};

/** Renders styles as React resources so navigation waits for CSS before revealing document content. */
function stylesheet(href: string) {
  return createElement("link", {
    key: href,
    rel: "stylesheet",
    href,
    precedence: "content-query-mdx",
  });
}

/** Resolves the module inside Suspense, preserving the host's providers and React identifier space. */
function DocumentContent({ reference, ...props }: MdxDocumentProps) {
  const loaded = resolveDocument(reference);
  const module = loaded instanceof Promise ? use(loaded) : loaded;
  return createElement(module.default, props);
}

/** Loads one server-selected document within the application's existing React root. */
export function MdxDocument({ reference, fallback = null, ...props }: MdxDocumentProps) {
  return createElement(
    Fragment,
    null,
    ...reference.css.map(stylesheet),
    createElement(Suspense, { fallback }, createElement(DocumentContent, { reference, ...props })),
  );
}

/** Props for server-rendered prose whose marked widgets own independent React roots. */
export type MdxIslandsProps = Omit<
  ComponentProps<"div">,
  "children" | "dangerouslySetInnerHTML"
> & {
  html: string;
  styles?: readonly string[];
  onIslandError?: MountIslandsOptions["onError"];
};

/** Owns a single immutable article so cleanup cancels work before React replaces its container. */
function IslandContent({ html, onIslandError, ...props }: Omit<MdxIslandsProps, "styles">) {
  const container = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const report = useRef(onIslandError);
  useLayoutEffect(() => {
    report.current = onIslandError;
  });
  useLayoutEffect(() => {
    const element = container.current!;
    if (initialized.current) {
      // Effect reconnection needs fresh SSR containers; old roots finish tearing down separately.
      element.innerHTML = html;
    }
    initialized.current = true;
    return mountIslands(element, {
      onError(cause, island) {
        if (report.current) {
          report.current(cause, island);
        } else {
          console.error("[content-query/mdx] Island initialization failed", cause);
        }
      },
      deferUnmount: true,
    });
  }, [html]);
  return createElement("div", {
    ...props,
    ref: container,
    dangerouslySetInnerHTML: { __html: html },
  });
}

/** Uses compact local revisions to replace changed HTML and manage island scheduling and disposal. */
export function MdxIslands({ html, styles = [], ...props }: MdxIslandsProps) {
  const [content, setContent] = useState({ html, revision: 0 });
  if (content.html !== html) {
    // React retries this component before reconciling children, preserving cleanup ordering.
    setContent({ html, revision: content.revision + 1 });
  }
  return createElement(
    Fragment,
    null,
    ...styles.map(stylesheet),
    createElement(IslandContent, { ...props, html, key: content.revision }),
  );
}

/** Creates a lazy browser-only component that remains inside its parent's React tree. */
export function createClientOnly(load: () => Promise<ComponentType<Record<string, unknown>>>) {
  /** Keeps server and initial browser markup identical before loading the browser-only module. */
  function ClientOnly(props: Record<string, unknown>) {
    const [Component, setComponent] = useState<ComponentType<Record<string, unknown>>>();
    const [failure, setFailure] = useState<unknown>();
    useEffect(() => {
      let active = true;
      void load().then(
        (loaded) => {
          if (active) {
            setComponent(() => loaded);
          }
        },
        (cause: unknown) => {
          if (active) {
            setFailure(() => cause);
          }
        },
      );
      return () => {
        active = false;
      };
    }, []);
    if (failure) {
      throw failure;
    }
    return Component ? createElement(Component, props) : null;
  }
  return ClientOnly;
}
