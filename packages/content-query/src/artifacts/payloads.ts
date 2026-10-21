import type { EncodedCollection } from "./types.ts";

type PayloadChunk = {
  ids: readonly string[];
  load(): Promise<{ default: Record<string, string> }>;
};

/**
 * Creates lazy entry loaders from compact chunk descriptors. Each chunk is imported once
 * on first payload access. Encoded entry graphs retain the ordinary artifact codec, and
 * failed imports can be retried.
 *
 * @param chunks - Entry identities and lazy imports for encoded payload maps.
 * @returns One encoded-payload loader for each entry, without loading any content yet.
 */
export function createPayloadLoaders(
  chunks: readonly PayloadChunk[],
): EncodedCollection["payloads"] {
  const loaders: EncodedCollection["payloads"] = Object.create(null);
  for (const chunk of chunks) {
    let loaded: Promise<Record<string, string>> | undefined;
    /** Shares one chunk import across concurrent entry requests. */
    function load(): Promise<Record<string, string>> {
      loaded ??= Promise.resolve()
        .then(() => chunk.load())
        .then((module) => module.default)
        .catch((cause: unknown) => {
          loaded = undefined;
          throw cause;
        });
      return loaded;
    }
    for (const id of chunk.ids) {
      loaders[id] = async () => ({ default: (await load())[id]! });
    }
  }
  return loaders;
}
