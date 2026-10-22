import type { MdxClientReference } from "../types.ts";

const styles = new Map<string, Promise<void>>();
const modules = new Map<string, Promise<unknown>>();

/** Loads a stylesheet once; server-linked styles are already available before hydration. */
export function loadStyle(url: string): Promise<void> {
  const absolute = new URL(url, document.baseURI).href;
  const loading = styles.get(absolute);
  if (loading) {
    return loading;
  }
  if (
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some(
      (link) => link.href === absolute,
    )
  ) {
    return Promise.resolve();
  }
  const pending = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = absolute;
    link.onload = () => {
      styles.delete(absolute);
      resolve();
    };
    link.onerror = () => {
      styles.delete(absolute);
      link.remove();
      reject(new Error(`Could not load MDX stylesheet ${url}.`));
    };
    document.head.append(link);
  });
  styles.set(absolute, pending);
  return pending;
}

/** Imports a server-selected native module without a browser-side document registry. */
export async function loadReference<Value>(reference: MdxClientReference): Promise<Value> {
  await Promise.all(reference.css.map(loadStyle));
  let pending = modules.get(reference.url);
  if (!pending) {
    pending = import(/* @vite-ignore */ reference.url).catch((cause: unknown) => {
      modules.delete(reference.url);
      throw cause;
    });
    modules.set(reference.url, pending);
  }
  return pending as Promise<Value>;
}
