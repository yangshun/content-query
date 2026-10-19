import { ContentError } from "../shared/errors.ts";
import { decode } from "../shared/values.ts";
import { createRuntime } from "../runtime/content.ts";
import { prepareRelationships } from "../runtime/relationships.ts";
import type { ItemPayload, PreparedRevision, QueryRecord } from "../runtime/revision.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { ContentRenderResult } from "../runtime/types.ts";
import {
  ARTIFACT_VERSION,
  CODEC_VERSION,
  type ArtifactManifest,
  type EncodedCollection,
} from "./types.ts";

/** Initializes generated/embedded prepared content. This versioned wiring is internal. */
export function createArtifactRevision(
  manifest: ArtifactManifest,
  collections: Record<string, EncodedCollection>,
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>,
) {
  try {
    if (manifest.version !== ARTIFACT_VERSION || manifest.codec !== CODEC_VERSION) {
      throw new Error("Incompatible content artifact or codec version; regenerate content.");
    }
    const revision: PreparedRevision = {
      registry: manifest.collections,
      collections: Object.create(null) as PreparedRevision["collections"],
      relations: new Map(),
      active: 0,
      payloadCache: new Map(),
      renderCache: new Map(),
      renderMarkdown,
    };
    for (const [name, descriptor] of Object.entries(manifest.collections)) {
      const encoded = collections[name];
      if (!encoded || !Array.isArray(encoded.records)) {
        throw new Error(`Missing collection artifact "${name}".`);
      }
      const records = encoded.records.map((record) => decode<QueryRecord>(record));
      if (
        records.some(
          (record) =>
            !record ||
            typeof record !== "object" ||
            Array.isArray(record) ||
            !Object.hasOwn(record, "id") ||
            typeof record.id !== "string" ||
            !record.id,
        ) ||
        new Set(records.map((record) => record.id)).size !== records.length
      ) {
        throw new Error(`Invalid query records for collection "${name}".`);
      }
      revision.collections[name] = {
        records,
        relationships: descriptor.relationships,
        payloads: new Map(
          Object.entries(encoded.payloads).map(([id, load]) => [
            id,
            async () => decode<ItemPayload>((await load()).default),
          ]),
        ),
      };
    }
    const errors = prepareRelationships(revision);
    if (errors.length) {
      throw errors[0];
    }
    return revision;
  } catch (cause) {
    throw new ContentError({
      code: "artifact-error",
      message: "Could not initialize prepared content.",
      cause,
    });
  }
}

/** Initializes the public generated server export from a complete immutable artifact revision. */
export function createArtifactRuntime<Registry extends CollectionRegistry>(
  manifest: ArtifactManifest,
  collections: Record<string, EncodedCollection>,
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>,
) {
  return createRuntime<Registry>({
    revision: createArtifactRevision(manifest, collections, renderMarkdown),
  });
}
