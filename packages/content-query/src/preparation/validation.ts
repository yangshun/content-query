import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ContentError, contentError, type ContentDiagnostic } from "../shared/errors.ts";
import { detach } from "../shared/values.ts";
import type { ItemPayload } from "../runtime/revision.ts";
import type { LoaderEntry } from "../loaders/types.ts";

/** Checks records independently from validation-provider schema introspection. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Validates one result, retaining structured provider issues and their original detail. */
export async function validate(
  schema: StandardSchemaV1 | undefined,
  value: unknown,
  context: Omit<ContentDiagnostic, "code" | "message">,
): Promise<unknown> {
  if (!schema) {
    return value;
  }
  try {
    const result = await schema["~standard"].validate(value);
    if (result.issues) {
      const firstPath = result.issues[0]?.path?.map((segment) =>
        typeof segment === "object" ? segment.key : segment,
      );
      throw new ContentError({
        ...context,
        code: "validation-error",
        message: result.issues.map((issue) => issue.message).join("; "),
        issues: result.issues,
        path: [...(context.path ?? []), ...(firstPath ?? [])],
      });
    }
    return result.value;
  } catch (cause) {
    throw contentError(cause, {
      ...context,
      code: "validation-error",
      message: "Schema validation failed.",
    });
  }
}

/** Checks loader transport structure and rejects duplicate snapshot/upsert identities. */
export function normalizeSnapshot(
  entries: readonly LoaderEntry[],
  collection: string,
): Map<string, LoaderEntry> {
  if (!Array.isArray(entries)) {
    throw new ContentError({
      code: "source-error",
      collection,
      message: "load() must return an array of structured entries.",
    });
  }
  const snapshot = new Map<string, LoaderEntry>();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id ||
      !isRecord(entry.data) ||
      (entry.body !== undefined && typeof entry.body !== "string") ||
      (entry.source !== undefined && typeof entry.source !== "string")
    ) {
      throw new ContentError({
        code: "source-error",
        collection,
        id:
          entry && typeof entry === "object" && typeof entry.id === "string" ? entry.id : undefined,
        source:
          entry && typeof entry === "object" && typeof entry.source === "string"
            ? entry.source
            : undefined,
        message: "Invalid structured loader entry.",
      });
    }
    if (snapshot.has(entry.id)) {
      throw new ContentError({
        code: "duplicate-id",
        collection,
        id: entry.id,
        source: entry.source,
        message: `Duplicate entry ID "${entry.id}".`,
      });
    }
    snapshot.set(entry.id, entry);
  }
  return snapshot;
}

/** Validates supplied rendering data and normalizes omitted headings. */
export function renderedPayload(entry: LoaderEntry): ItemPayload["rendered"] {
  if (entry.rendered === undefined) {
    return undefined;
  }
  const rendered = entry.rendered;
  if (
    !rendered ||
    typeof rendered.html !== "string" ||
    (rendered.metadata !== undefined &&
      (!isRecord(rendered.metadata) ||
        (rendered.metadata.headings !== undefined &&
          (!Array.isArray(rendered.metadata.headings) ||
            rendered.metadata.headings.some(
              (heading) =>
                !heading ||
                !Number.isInteger(heading.depth) ||
                heading.depth < 1 ||
                heading.depth > 6 ||
                typeof heading.slug !== "string" ||
                typeof heading.text !== "string",
            )))))
  ) {
    throw new Error("Invalid supplied HTML/headings payload.");
  }
  return { html: rendered.html, headings: detach(rendered.metadata?.headings ?? []) };
}
