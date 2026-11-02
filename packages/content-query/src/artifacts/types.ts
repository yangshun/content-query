import type { QueryRegistry } from "../query/plan.ts";

export const ARTIFACT_VERSION = 2;
export const CODEC_VERSION = "devalue-6.0.2";

export type ArtifactManifest = {
  version: number;
  codec: string;
  collections: QueryRegistry;
};
export type EncodedCollection = {
  records: readonly string[];
  /** Lazy encoded built-in payloads, keyed by entry ID. */
  builtins: Record<string, () => Promise<{ default: string }>>;
};
