import type { ContentError } from "../shared/errors.ts";
import type { QueryPlan, QueryRegistry } from "../query/plan.ts";
import type { Relationship } from "../collection/types.ts";
import type { ContentRenderResult } from "./types.ts";

export type QueryRecord = Record<string, unknown> & { id: string };
export type ItemPayload = {
  body?: string;
  rendered?: ContentRenderResult;
  markdown?: string;
};
export type PreparedCollection = {
  records: readonly QueryRecord[];
  relationships: Record<string, Relationship>;
  payloads: ReadonlyMap<string, () => Promise<ItemPayload>>;
  sources?: ReadonlyMap<string, string | undefined>;
};
export type PreparedRevision = {
  registry: QueryRegistry;
  collections: Record<string, PreparedCollection>;
  relations: Map<string, Map<string, readonly QueryRecord[]>>;
  active: number;
  payloadCache: Map<string, Promise<ItemPayload>>;
  renderCache: Map<string, Promise<ContentRenderResult>>;
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>;
  execute?: (plan: QueryPlan, terminal: "all" | "first" | "count") => Promise<unknown>;
};
export type ContentState = {
  revision?: PreparedRevision;
  registry?: QueryRegistry;
  error?: ContentError;
};
