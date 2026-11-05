import type { QueryRegistry } from "../query/plan.ts";
import type { QueryStyle } from "../runtime/query-style.ts";

export const ARTIFACT_VERSION = 3;
export const CODEC_VERSION = "devalue-6.0.2";

export type ArtifactManifest = {
  version: number;
  codec: string;
  collections: QueryRegistry;
  /** Optional and additive, so it needs no version bump; absent allows both query styles. */
  queryStyle?: QueryStyle;
};
export type EncodedCollection = {
  records: readonly string[];
  /** Lazy encoded built-in payloads, keyed by entry ID. */
  builtins: Record<string, () => Promise<{ default: string }>>;
  /** Lazy encoded custom payloads by payload name, entry ID, and canonical variant key. */
  payloads?: Record<string, Record<string, Record<string, () => Promise<{ default: string }>>>>;
};
