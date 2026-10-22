"use client";

import { createElement, type ComponentType } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

/** Mounts one generated widget entry and returns the cleanup owned by its document lifecycle. */
export function mountReactIsland(
  element: HTMLElement,
  Component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  options: { clientOnly: boolean; prefix: string; onError: (cause: unknown) => void },
): () => void {
  const node = createElement(Component, props);
  const root = options.clientOnly
    ? createRoot(element, { identifierPrefix: options.prefix, onUncaughtError: options.onError })
    : hydrateRoot(element, node, {
        identifierPrefix: options.prefix,
        onRecoverableError: options.onError,
        onUncaughtError: options.onError,
      });
  if (options.clientOnly) {
    root.render(node);
  }
  return () => root.unmount();
}
