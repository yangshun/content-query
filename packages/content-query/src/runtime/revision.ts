import type { ContentError } from "../shared/errors.ts";
import type { QueryPlan, QueryRegistry } from "../query/plan.ts";
import type { Relationship } from "../collection/types.ts";
import type { ContentRenderResult } from "./types.ts";
import type { QueryStyle } from "./query-style.ts";

export type QueryRecord = Record<string, unknown> & { id: string };
/** The built-in side payload shared by an entry's `_body` and `_rendered` payloads. */
export type BuiltinPayload = {
  body?: string;
  rendered?: ContentRenderResult;
  markdown?: string;
};
export type PreparedCollection = {
  records: readonly QueryRecord[];
  relationships: Record<string, Relationship>;
  /** Lazy built-in payloads, present only for entries with a body or rendered output. */
  builtins: ReadonlyMap<string, () => Promise<BuiltinPayload>>;
  sources?: ReadonlyMap<string, string | undefined>;
};
export type PreparedRevision = {
  registry: QueryRegistry;
  collections: Record<string, PreparedCollection>;
  relations: Map<string, Map<string, readonly QueryRecord[]>>;
  active: number;
  payloadCache: Map<string, Promise<BuiltinPayload>>;
  renderCache: Map<string, Promise<ContentRenderResult>>;
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>;
  /** The only query style this revision's configuration allows; absent allows both. */
  queryStyle?: QueryStyle;
  execute?: (
    plan: QueryPlan,
    terminal: "all" | "first" | "count",
    requests: PayloadRequest[],
  ) => Promise<unknown>;
};
/** A projected row awaiting the payloads its query scope requested. */
export type PayloadRequest = {
  target: Record<string, unknown>;
  collection: string;
  id: string;
  payloads: NonNullable<QueryPlan["payloads"]>;
};
export type ContentState = {
  revision?: PreparedRevision;
  registry?: QueryRegistry;
  error?: ContentError;
};
