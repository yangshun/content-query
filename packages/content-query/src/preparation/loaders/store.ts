import type { DataStore, MetaStore } from "../../loaders/types.ts";
import type { Schema } from "../../collection/types.ts";
import { detach } from "../../shared/values.ts";

export type StoredEntry = NonNullable<ReturnType<DataStore["get"]>>;
export type LoaderStoreState = {
  entries: Map<string, StoredEntry>;
  metadata: Map<string, string>;
};

/** Creates an isolated native loader store, retaining validation identity across defensive copies. */
export function createStores(
  current: () => LoaderStoreState,
  parsed: WeakMap<object, Schema | undefined>,
  changed: () => void,
): { store: DataStore; meta: MetaStore } {
  /** Copies entries without exposing mutable preparation state to loader code. */
  function copy(entry: StoredEntry): StoredEntry {
    const copied = detach(entry);
    if (parsed.has(entry.data)) {
      parsed.set(copied.data, parsed.get(entry.data));
    }
    return copied;
  }
  return {
    store: {
      get<Data extends Record<string, unknown>>(key: string) {
        const entry = current().entries.get(String(key));
        return entry ? (copy(entry) as StoredEntry & { data: Data }) : undefined;
      },
      entries: () => [...current().entries].map(([key, entry]) => [key, copy(entry)]),
      values: () => [...current().entries.values()].map(copy),
      keys: () => [...current().entries.keys()],
      has: (key) => current().entries.has(String(key)),
      set(entry) {
        if (
          entry.deferredRender ||
          entry.assetImports?.length ||
          entry.imageImports?.length ||
          entry.rendered?.metadata?.imagePaths?.length
        ) {
          throw new Error(
            "Astro loader module and image imports require Astro's rendering pipeline; supply portable HTML or use a ContentQuery loader.",
          );
        }
        const id = entry.id;
        if (
          typeof id !== "string" ||
          !id ||
          !entry.data ||
          typeof entry.data !== "object" ||
          Array.isArray(entry.data)
        ) {
          throw new Error("Astro store entries require a nonempty id and record data.");
        }
        const previous = current().entries.get(id);
        if (entry.digest !== undefined && previous?.digest === entry.digest) {
          return false;
        }
        current().entries.set(id, copy({ ...entry, id }));
        changed();
        return true;
      },
      delete(key) {
        if (current().entries.delete(String(key))) {
          changed();
        }
      },
      clear() {
        if (current().entries.size) {
          current().entries.clear();
          changed();
        }
      },
      addModuleImport() {
        throw new Error("Astro loader module imports require Astro's rendering pipeline.");
      },
    },
    meta: {
      get: (key) => current().metadata.get(key),
      has: (key) => current().metadata.has(key),
      set: (key, value) => {
        current().metadata.set(key, value);
      },
      delete: (key) => {
        current().metadata.delete(key);
      },
    },
  };
}
