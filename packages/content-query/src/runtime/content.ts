import { ContentError, contentError, invalidQuery } from "../shared/errors.ts";
import { mapConcurrent } from "../shared/concurrency.ts";
import { assertServerOnly } from "../shared/server-only.ts";
import { detach } from "../shared/values.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { InvalidRelationships } from "../collection/registry-types.ts";
import { createQueryNamespace, relationalPlan } from "../query/relational.ts";
import type { RelationalQueries, RelationalCountOptions } from "../query/relational-types.ts";
import type { SelectFrom } from "../query/select.ts";
import { createSelect } from "../query/select.ts";
import { normalizePlan } from "../query/normalize.ts";
import { executeQuery } from "./execute.ts";
import type { BuiltinPayload, ContentState, PayloadRequest, PreparedRevision } from "./revision.ts";
import {
  queryStyleDisabledMessage,
  styleOfMember,
  type MembersOf,
  type QueryStyle,
  type QueryStyleDisabled,
  type QueryStyleMember,
} from "./query-style.ts";

assertServerOnly();
type ContentMethods<Registry extends CollectionRegistry = {}> = {
  /** Starts a SQL-ordered fluent query; field names are checked against the collection in from(). */
  select<const Keys extends readonly string[]>(...fields: Keys): SelectFrom<Registry, Keys>;
  /** Collection-scoped relational queries with typed columns, relationships, payloads, and filters. */
  readonly query: RelationalQueries<Registry>;
  /** Counts matching entries before pagination, like the fluent count terminal. */
  count<Name extends keyof Registry & string>(
    collection: Name,
    options?: RelationalCountOptions<Registry, Name>,
  ): Promise<number>;
};
/**
 * Root members outside the allowed style. Property access reports the message type directly; a
 * call reports it as the required `this` type, whatever arguments it passes.
 */
type DisabledMembers<Style extends QueryStyle> = {
  readonly [Member in Exclude<QueryStyleMember, MembersOf<Style>>]: ContentMethods[Member] extends (
    ...arguments_: never
  ) => unknown
    ? (this: QueryStyleDisabled<Member, Style>, ...arguments_: readonly unknown[]) => never
    : QueryStyleDisabled<Member, Style>;
};
/**
 * The generated `content` export. `Style` narrows the root query APIs to the `queryStyle` exported
 * by content-query.config; the default allows both fluent and relational queries.
 *
 * The gate avoids a conditional on `Style`: a conditional on a generic `Style` would make
 * `ContentSession<Registry>` invariant in `Registry` and break assignment to wider sessions.
 */
export type Content<
  Registry extends CollectionRegistry = {},
  Style extends QueryStyle = QueryStyle,
> =
  InvalidRelationships<Registry> extends never
    ? Pick<ContentMethods<Registry>, MembersOf<Style>> & DisabledMembers<Style>
    : { readonly invalidRelationships: InvalidRelationships<Registry> };

/** Maximum payload loads in flight for one query. */
const PAYLOAD_CONCURRENCY = 16;

/** Pins the latest valid revision for an entire asynchronous operation. */
async function pinned<Value>(
  state: ContentState,
  operation: (revision: PreparedRevision) => Promise<Value>,
): Promise<Value> {
  if (state.error) {
    throw state.error;
  }
  const revision = state.revision;
  if (!revision) {
    throw new ContentError({
      code: "artifact-error",
      message: "No prepared content revision is available.",
    });
  }
  revision.active++;
  try {
    return await operation(revision);
  } finally {
    revision.active--;
  }
}

/** Checks a decoded built-in payload before any of its values reach a query result. */
function validBuiltinPayload(payload: unknown): payload is BuiltinPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const { body, markdown, rendered } = payload as BuiltinPayload;
  return (
    (body === undefined || typeof body === "string") &&
    (markdown === undefined || typeof markdown === "string") &&
    (rendered === undefined ||
      (!!rendered &&
        typeof rendered.html === "string" &&
        Array.isArray(rendered.headings) &&
        rendered.headings.every(
          (heading) =>
            !!heading &&
            Number.isInteger(heading.depth) &&
            heading.depth >= 1 &&
            heading.depth <= 6 &&
            typeof heading.slug === "string" &&
            typeof heading.text === "string",
        )))
  );
}

/** Lazily loads one entry's built-in payload once per revision, retrying after failures. */
function loadBuiltin(
  revision: PreparedRevision,
  collection: string,
  id: string,
): Promise<BuiltinPayload> {
  const key = JSON.stringify([collection, id]);
  let loaded = revision.payloadCache.get(key);
  if (!loaded) {
    loaded = Promise.resolve()
      .then(async () => {
        const payload: unknown =
          (await revision.collections[collection]!.builtins.get(id)?.()) ?? {};
        if (!validBuiltinPayload(payload)) {
          throw new Error("Invalid prepared payload shape.");
        }
        return payload;
      })
      .catch((cause: unknown) => {
        revision.payloadCache.delete(key);
        throw contentError(cause, {
          code: "artifact-error",
          collection,
          id,
          message: "Could not load the prepared entry payload.",
        });
      });
    revision.payloadCache.set(key, loaded);
  }
  return loaded;
}

/** Returns supplied or eagerly compiled output, or renders captured Markdown once per revision. */
async function renderedPayload(revision: PreparedRevision, collection: string, id: string) {
  const payload = await loadBuiltin(revision, collection, id);
  if (payload.rendered) {
    return payload.rendered;
  }
  if (payload.markdown === undefined) {
    throw new ContentError({
      code: "not-renderable",
      collection,
      id,
      message: "This entry has no supplied output or supported rendering path.",
    });
  }
  const key = JSON.stringify([collection, id]);
  let rendered = revision.renderCache.get(key);
  if (!rendered) {
    rendered = Promise.resolve()
      .then(() => {
        if (!revision.renderMarkdown) {
          throw new Error("Missing packaged Markdown renderer.");
        }
        return revision.renderMarkdown(payload.markdown!);
      })
      .catch((cause: unknown) => {
        revision.renderCache.delete(key);
        throw contentError(cause, {
          code: "render-error",
          collection,
          id,
          message: "Markdown rendering failed.",
        });
      });
    revision.renderCache.set(key, rendered);
  }
  return rendered;
}

/** Loads one requested payload value from the pinned revision. */
async function loadPayload(
  revision: PreparedRevision,
  collection: string,
  id: string,
  name: string,
): Promise<unknown> {
  if (name === "_body") {
    return (await loadBuiltin(revision, collection, id)).body;
  }
  if (name === "_rendered") {
    return renderedPayload(revision, collection, id);
  }
  invalidQuery(`Payload "${name}" no longer matches the prepared collection.`);
}

/**
 * Loads every requested payload with bounded concurrency, then attaches detached copies under
 * `_payloads`. Each distinct payload loads once; rows that share an entry get independent values.
 */
async function attachPayloads(
  revision: PreparedRevision,
  requests: readonly PayloadRequest[],
): Promise<void> {
  if (!requests.length) {
    return;
  }
  const loads = new Map<string, { collection: string; id: string; name: string }>();
  for (const request of requests) {
    for (const name of Object.keys(request.payloads)) {
      const key = JSON.stringify([request.collection, request.id, name, request.payloads[name]]);
      if (!loads.has(key)) {
        loads.set(key, { collection: request.collection, id: request.id, name });
      }
    }
  }
  const keys = [...loads.keys()];
  const values = await mapConcurrent(keys, PAYLOAD_CONCURRENCY, (key) => {
    const { collection, id, name } = loads.get(key)!;
    return loadPayload(revision, collection, id, name);
  });
  const loaded = new Map(keys.map((key, index) => [key, values[index]]));
  for (const request of requests) {
    request.target._payloads = Object.fromEntries(
      Object.keys(request.payloads).map((name) => [
        name,
        detach(
          loaded.get(
            JSON.stringify([request.collection, request.id, name, request.payloads[name]]),
          ),
        ),
      ]),
    );
  }
}

/**
 * Creates the initialized runtime without importing source configuration or schemas.
 *
 * @param state - Mutable session or artifact state; each query reads its current revision.
 * @returns The `content` API. Root members outside the current revision's `queryStyle` throw an
 * `invalid-query` ContentError when accessed or called.
 */
export function createRuntime<
  Registry extends CollectionRegistry,
  Style extends QueryStyle = QueryStyle,
>(state: ContentState): Content<Registry, Style> {
  /** Pins query execution and payload loading to exactly the same revision and executor. */
  const run: import("../query/plan.ts").QueryRunner = (plan, terminal) =>
    pinned(state, async (revision) => {
      const normalized = normalizePlan(plan);
      const requests: PayloadRequest[] = [];
      const result = revision.execute
        ? await revision.execute(normalized, terminal, requests)
        : await executeQuery(revision, normalized, terminal, requests);
      await attachPayloads(revision, requests);
      return result;
    });
  /** Reads the current registry without capturing a development revision in either API. */
  const registry = () => state.registry ?? state.revision?.registry ?? {};
  /** Rejects a root member that the current revision's configured query style disables. */
  function allow(member: QueryStyleMember): void {
    const style = state.revision?.queryStyle;
    if (style && styleOfMember(member) !== style) {
      invalidQuery(queryStyleDisabledMessage(member, style));
    }
  }
  const queries = createQueryNamespace(registry, run) as RelationalQueries<Registry>;
  const runtime: ContentMethods<Registry> = {
    select(...fields) {
      allow("select");
      return createSelect(registry, run, fields) as never;
    },
    get query() {
      allow("query");
      return queries;
    },
    count(collection, options = {}) {
      allow("count");
      return run(relationalPlan(registry(), collection, options), "count") as Promise<number>;
    },
  };
  return runtime as unknown as Content<Registry, Style>;
}

/** Keeps dev builders live across host-delivered revisions while pinning active operations. */
export function createLiveRuntime(initial: ContentState) {
  const state = { ...initial };
  return {
    content: createRuntime(state),
    update(next: ContentState) {
      state.revision = next.revision;
      state.registry = next.registry;
      state.error = next.error;
    },
  };
}
