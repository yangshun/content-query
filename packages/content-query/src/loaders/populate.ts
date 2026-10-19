import type { LoaderContext, LoaderEntry } from "./types.ts";
import { normalizeSnapshot } from "../preparation/validation.ts";
import { ContentError, groupDiagnostics } from "../shared/errors.ts";

/** Validates a complete built-in source before replacing its collection store. */
export async function populateStore<Source>(
  context: LoaderContext<Source>,
  entries: LoaderEntry<Source>[],
): Promise<void> {
  normalizeSnapshot(entries, context.collection);
  const results = await Promise.allSettled(
    entries.map(async (entry) => ({
      id: entry.id,
      data: await context.parseData({ id: entry.id, data: entry.data, filePath: entry.source }),
      ...(entry.body === undefined ? {} : { body: entry.body }),
      ...(entry.rendered === undefined ? {} : { rendered: entry.rendered }),
      ...(entry.source === undefined ? {} : { filePath: entry.source }),
      ...(entry.sourceData === undefined ? {} : { source: entry.sourceData }),
    })),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? (result.reason as ContentError).diagnostics : [],
  );
  if (failures.length) {
    throw groupDiagnostics(failures);
  }
  context.store.clear();
  for (const result of results) {
    if (result.status === "fulfilled") {
      context.store.set(result.value);
    }
  }
}
