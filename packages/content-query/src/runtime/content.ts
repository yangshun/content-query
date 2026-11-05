import { ContentError, contentError, invalidQuery, payloadIdentity } from "../shared/errors.ts";
import { mapConcurrent } from "../shared/concurrency.ts";
import { assertServerOnly } from "../shared/server-only.ts";
import { detach } from "../shared/values.ts";
import type { QueryRunner } from "../query/plan.ts";
import { normalizePlan } from "../query/normalize.ts";
import { executeQuery } from "./execute.ts";
import {
  variantKey,
  type BuiltinPayload,
  type ContentState,
  type PayloadRequest,
  type PreparedRevision,
} from "./revision.ts";

assertServerOnly();
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
  let loaded = revision.payloadCache.get(key) as Promise<BuiltinPayload> | undefined;
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

/** Lazily loads one custom payload variant once per revision, retrying after failures. */
function loadCustom(
  revision: PreparedRevision,
  collection: string,
  id: string,
  name: string,
  variant: Readonly<Record<string, string>>,
): Promise<unknown> {
  const entries = revision.collections[collection]!.payloads?.get(name);
  if (!entries) {
    invalidQuery(`Payload "${name}" no longer matches the prepared collection.`);
  }
  const load = entries.get(id)?.get(variantKey(variant));
  if (!load) {
    return Promise.reject(
      new ContentError({
        code: "variant-not-found",
        operation: "query",
        collection,
        id,
        payload: name,
        variant,
        message: `Entry "${id}" has no ${payloadIdentity(name, variant)} payload.`,
      }),
    );
  }
  const key = JSON.stringify([collection, id, name, variantKey(variant)]);
  let loaded = revision.payloadCache.get(key);
  if (!loaded) {
    loaded = Promise.resolve()
      .then(load)
      .catch((cause: unknown) => {
        revision.payloadCache.delete(key);
        throw contentError(cause, {
          code: "artifact-error",
          collection,
          id,
          payload: name,
          variant,
          message: `Could not load the prepared ${payloadIdentity(name, variant)} payload.`,
        });
      });
    revision.payloadCache.set(key, loaded);
  }
  return loaded;
}

/** Loads one requested payload value from the pinned revision. */
async function loadPayload(
  revision: PreparedRevision,
  collection: string,
  id: string,
  name: string,
  variant: Readonly<Record<string, string>>,
): Promise<unknown> {
  if (name === "_body") {
    return (await loadBuiltin(revision, collection, id)).body;
  }
  if (name === "_rendered") {
    return renderedPayload(revision, collection, id);
  }
  return loadCustom(revision, collection, id, name, variant);
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
  const loads = new Map<
    string,
    { collection: string; id: string; name: string; variant: Readonly<Record<string, string>> }
  >();
  for (const request of requests) {
    for (const name of Object.keys(request.payloads)) {
      const key = JSON.stringify([request.collection, request.id, name, request.payloads[name]]);
      if (!loads.has(key)) {
        loads.set(key, {
          collection: request.collection,
          id: request.id,
          name,
          variant: request.payloads[name]!.variant,
        });
      }
    }
  }
  const keys = [...loads.keys()];
  const values = await mapConcurrent(keys, PAYLOAD_CONCURRENCY, (key) => {
    const { collection, id, name, variant } = loads.get(key)!;
    return loadPayload(revision, collection, id, name, variant);
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
 * Creates the query runner that pins plan execution and payload loading to one revision.
 *
 * @param state - Mutable session, artifact, or combined state; each query reads its revision.
 * @returns A runner for fluent and relational plans.
 */
export function createRunner(state: ContentState): QueryRunner {
  return (plan, terminal) =>
    pinned(state, async (revision) => {
      const normalized = normalizePlan(plan);
      const requests: PayloadRequest[] = [];
      const result = revision.execute
        ? await revision.execute(normalized, terminal, requests)
        : await executeQuery(revision, normalized, terminal, requests);
      await attachPayloads(revision, requests);
      return result;
    });
}
