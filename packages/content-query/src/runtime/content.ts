import { ContentError, contentError, invalidQuery } from "../shared/errors.ts";
import { assertServerOnly } from "../shared/server-only.ts";
import { detach } from "../shared/values.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { InvalidRelationships } from "../collection/registry-types.ts";
import { createBuilder } from "../query/builder.ts";
import { emptyPlan } from "../query/plan.ts";
import type {
  Query,
  QueryOptions,
  CountOptions,
  SelectionResult,
  CheckedOptions,
} from "../query/types.ts";
import { objectPlan } from "../query/object.ts";
import { normalizePlan } from "../query/normalize.ts";
import { executeQuery } from "./execute.ts";
import type { ContentState, ItemPayload, PreparedRevision, QueryRecord } from "./revision.ts";
import type { ContentRenderResult } from "./types.ts";

assertServerOnly();
type ContentMethods<Registry extends CollectionRegistry = {}> = {
  query<Name extends keyof Registry & string>(collection: Name): Query<Registry, Name>;
  /** Executes an explicitly selected object query through the shared runtime. */
  findMany<
    Name extends keyof Registry & string,
    const Options extends QueryOptions<Registry, Name>,
  >(
    collection: Name,
    options: Options & CheckedOptions<Registry, Name, NoInfer<Options>>,
  ): Promise<SelectionResult<Registry, Name, Options["select"]>[]>;
  /** Returns the first selected row, or undefined when its scope has no entries. */
  findFirst<
    Name extends keyof Registry & string,
    const Options extends QueryOptions<Registry, Name>,
  >(
    collection: Name,
    options: Options & CheckedOptions<Registry, Name, NoInfer<Options>>,
  ): Promise<SelectionResult<Registry, Name, Options["select"]> | undefined>;
  /** Counts matching entries before pagination, like the fluent count terminal. */
  count<Name extends keyof Registry & string>(
    collection: Name,
    options?: CountOptions<Registry, Name>,
  ): Promise<number>;
  readBody(collection: keyof Registry & string, id: string): Promise<string | undefined>;
  render(collection: keyof Registry & string, id: string): Promise<ContentRenderResult>;
};
export type Content<Registry extends CollectionRegistry = {}> =
  InvalidRelationships<Registry> extends never
    ? ContentMethods<Registry>
    : { readonly invalidRelationships: InvalidRelationships<Registry> };

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

const idSets = new WeakMap<readonly QueryRecord[], ReadonlySet<string>>();

/** Indexes immutable prepared records once, so body/render lookups avoid collection scans. */
function entryIds(records: readonly QueryRecord[]): ReadonlySet<string> {
  let ids = idSets.get(records);
  if (!ids) {
    ids = new Set(records.map((record) => record.id));
    idSets.set(records, ids);
  }
  return ids;
}

/** Looks up an entry and lazily loads only its revision-specific payload. */
async function loadPayload(
  revision: PreparedRevision,
  collectionName: string,
  id: string,
): Promise<ItemPayload> {
  const collection = revision.collections[collectionName];
  if (!collection || typeof collectionName !== "string" || typeof id !== "string") {
    invalidQuery("Body/render access requires a registered collection and string ID.");
  }
  if (!entryIds(collection.records).has(id)) {
    throw new ContentError({
      code: "entry-not-found",
      collection: collectionName,
      id,
      message: `Entry "${id}" does not exist in "${collectionName}".`,
    });
  }
  const key = JSON.stringify([collectionName, id]);
  let loaded = revision.payloadCache.get(key);
  if (!loaded) {
    loaded = Promise.resolve()
      .then(async () => {
        const payload: ItemPayload = await (collection.payloads.get(id)?.() ?? {});
        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          (payload.body !== undefined && typeof payload.body !== "string") ||
          (payload.markdown !== undefined && typeof payload.markdown !== "string") ||
          (payload.rendered !== undefined &&
            (!payload.rendered ||
              typeof payload.rendered.html !== "string" ||
              !Array.isArray(payload.rendered.headings) ||
              payload.rendered.headings.some(
                (heading) =>
                  !heading ||
                  !Number.isInteger(heading.depth) ||
                  heading.depth < 1 ||
                  heading.depth > 6 ||
                  typeof heading.slug !== "string" ||
                  typeof heading.text !== "string",
              )))
        ) {
          throw new Error("Invalid prepared payload shape.");
        }
        return payload;
      })
      .catch((cause: unknown) => {
        revision.payloadCache.delete(key);
        throw contentError(cause, {
          code: "artifact-error",
          collection: collectionName,
          id,
          message: "Could not load the prepared entry payload.",
        });
      });
    revision.payloadCache.set(key, loaded);
  }
  return loaded;
}

/** Creates the initialized runtime without importing source configuration or schemas. */
export function createRuntime<Registry extends CollectionRegistry>(
  state: ContentState,
): Content<Registry> {
  /** Pins both query frontends to exactly the same revision and backend executor. */
  const run: import("../query/plan.ts").QueryRunner = (plan, terminal) =>
    pinned(state, (revision) =>
      revision.execute
        ? revision.execute(normalizePlan(plan), terminal)
        : executeQuery(revision, normalizePlan(plan), terminal),
    );
  /** Reads the current registry without capturing a development revision in either API. */
  const registry = () => state.registry ?? state.revision?.registry ?? {};
  const runtime: ContentMethods<Registry> = {
    query(collection) {
      const registry = state.registry ?? state.revision?.registry ?? {};
      if (!Object.hasOwn(registry, collection)) {
        invalidQuery(`Unknown collection "${collection}".`);
      }
      return createBuilder(registry, run, emptyPlan(collection)) as Query<
        Registry,
        typeof collection
      >;
    },
    findMany(collection, options) {
      return run(objectPlan(registry(), collection, options), "all") as never;
    },
    findFirst(collection, options) {
      return run(objectPlan(registry(), collection, options), "first") as never;
    },
    count(collection, options = {}) {
      return run(objectPlan(registry(), collection, options), "count") as Promise<number>;
    },
    readBody(collection, id) {
      return pinned(state, async (revision) => (await loadPayload(revision, collection, id)).body);
    },
    render(collection, id) {
      return pinned(state, async (revision) => {
        const payload = await loadPayload(revision, collection, id);
        if (payload.rendered) {
          return detach(payload.rendered);
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
        return detach(await rendered);
      });
    },
  };
  return runtime as Content<Registry>;
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
