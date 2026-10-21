import type { EncodedCollection } from "./types.ts";
import { gunzipSync } from "fflate/browser";

/**
 * Restores gzip/base64 JSON using a synchronous, portable decoder. Generated metadata indexes
 * can initialize without asynchronous module evaluation or runtime-specific compression APIs.
 *
 * @param encoded - The base64 representation of a gzip-compressed JSON document.
 * @returns The original JSON value; malformed input throws to the artifact error boundary.
 */
export function decodeCompressed<Value>(encoded: string): Value {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return JSON.parse(new TextDecoder().decode(gunzipSync(bytes))) as Value;
}

type PayloadChunk = {
  ids: readonly string[];
  load(): Promise<{ default: string | Record<string, string> }>;
};

/**
 * Creates lazy entry loaders from compact chunk descriptors. Each chunk is imported and,
 * when compressed, expanded once on first payload access. Encoded entry graphs retain the
 * ordinary artifact codec; failed imports or decompression can be retried.
 *
 * @param chunks - Entry identities and lazy imports for raw or gzip/base64 payload maps.
 * @returns One encoded-payload loader for each entry, without loading any content yet.
 */
export function createPayloadLoaders(
  chunks: readonly PayloadChunk[],
): EncodedCollection["payloads"] {
  const loaders: EncodedCollection["payloads"] = Object.create(null);
  for (const chunk of chunks) {
    let loaded: Promise<Record<string, string>> | undefined;
    /** Shares one chunk import and decompression across concurrent entry requests. */
    function load(): Promise<Record<string, string>> {
      loaded ??= Promise.resolve()
        .then(() => chunk.load())
        .then((module) => {
          if (typeof module.default !== "string") {
            return module.default;
          }
          return decodeCompressed<Record<string, string>>(module.default);
        })
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
