import { loadMdx } from "../client.ts";
import type { MdxClientReference, MdxModule } from "../types.ts";

const documents = new Map<string, MdxModule | Promise<MdxModule>>();

/** Retains a server-loaded module for synchronous rendering within the application's React tree. */
export function registerDocument(reference: MdxClientReference, module: MdxModule): void {
  documents.set(reference.url, module);
}

/** Reuses a selected module or a stable Suspense promise, without creating a browser corpus index. */
export function resolveDocument(reference: MdxClientReference): MdxModule | Promise<MdxModule> {
  let module = documents.get(reference.url);
  if (!module) {
    module = loadMdx(reference).catch((cause: unknown) => {
      documents.delete(reference.url);
      throw cause;
    });
    documents.set(reference.url, module);
  }
  return module;
}
