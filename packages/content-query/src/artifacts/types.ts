import type { QueryRegistry } from "../query/plan.ts";

export const ARTIFACT_VERSION = 1;
export const CODEC_VERSION = "devalue-6.0.2";

export type ArtifactManifest = {
  version: number;
  codec: string;
  collections: QueryRegistry;
};
export type EncodedCollection = {
  records: readonly string[];
  payloads: Record<string, () => Promise<{ default: string }>>;
};
