import {
  documentKey,
  type MdxAssetManifest,
  type MdxAssets,
  type MdxClientReference,
} from "./types.ts";

export type { MdxAssetManifest, MdxAssets, MdxClientReference } from "./types.ts";

/** Creates a server-side resolver without importing Vite, reading files, or exposing the corpus to clients. */
export function createMdxAssets(manifest: MdxAssetManifest): MdxAssets {
  if (manifest.version !== 1) {
    throw new Error("Unsupported MDX asset manifest version.");
  }
  /** Returns detached references so application code cannot mutate the retained manifest. */
  function reference(value: MdxClientReference | undefined, label: string): MdxClientReference {
    if (!value) {
      throw new Error(
        `No browser entry for ${label}; enable the corresponding MDX rendering mode.`,
      );
    }
    return { url: value.url, css: [...value.css] };
  }
  return {
    document(collection, id) {
      const key = documentKey(collection, id);
      return reference(
        Object.hasOwn(manifest.documents, key) ? manifest.documents[key]?.client : undefined,
        `MDX document ${key}`,
      );
    },
    island(id) {
      return reference(
        Object.hasOwn(manifest.islands, id) ? manifest.islands[id] : undefined,
        `MDX widget ${id}`,
      );
    },
    styles(collection, id) {
      const key = documentKey(collection, id);
      if (!Object.hasOwn(manifest.documents, key)) {
        throw new Error(`Unknown MDX document ${key}.`);
      }
      return [...manifest.documents[key]!.css];
    },
  };
}
