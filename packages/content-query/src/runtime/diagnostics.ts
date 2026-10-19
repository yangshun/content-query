import { ContentError, type ContentDiagnostic } from "../shared/errors.ts";
import { decode, encode } from "../shared/values.ts";

type ErrorEnvelope = {
  error: ContentDiagnostic & { diagnostics: readonly ContentDiagnostic[]; stack?: string };
  causes: object[];
};

/** Transports Error nodes as records while preserving the supported diagnostic value graph. */
function diagnosticGraph(
  value: unknown,
  causes: Set<object>,
  restore: boolean,
  seen = new Map<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    result.length = value.length;
    seen.set(value, result);
    value.forEach((item, index) => {
      result[index] = diagnosticGraph(item, causes, restore, seen);
    });
    return result;
  }
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>();
    seen.set(value, result);
    for (const [key, item] of value) {
      result.set(
        diagnosticGraph(key, causes, restore, seen),
        diagnosticGraph(item, causes, restore, seen),
      );
    }
    return result;
  }
  if (value instanceof Set) {
    const result = new Set<unknown>();
    seen.set(value, result);
    for (const item of value) {
      result.add(diagnosticGraph(item, causes, restore, seen));
    }
    return result;
  }
  const isError = restore ? causes.has(value) : value instanceof Error;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!isError && prototype !== Object.prototype && prototype !== null) {
    // Native values, including shared binary views, are already handled by the codec.
    return value;
  }
  const result: object =
    restore && isError ? new Error() : Object.create(isError ? Object.prototype : prototype);
  seen.set(value, result);
  if (!restore && isError) {
    causes.add(result);
  }
  const properties =
    !restore && value instanceof Error
      ? {
          ...Object.fromEntries(Object.entries(value)),
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        }
      : value;
  for (const [key, item] of Object.entries(properties)) {
    Object.defineProperty(result, key, {
      value: diagnosticGraph(item, causes, restore, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Encodes contextual development failures without reducing BigInts or structured issues to JSON. */
export function serializeContentError(error: ContentError): string {
  const causes = new Set<object>();
  const details: ErrorEnvelope["error"] = {
    code: error.code,
    message: error.message,
    stack: error.stack,
    operation: error.operation,
    collection: error.collection,
    id: error.id,
    source: error.source,
    path: error.path,
    issues: error.issues,
    cause: error.cause,
    diagnostics: error.diagnostics,
  };
  return encode({ error: diagnosticGraph(details, causes, false), causes: [...causes] });
}

/** Restores the library error and its causes in a generated or isolated development runtime. */
export function restoreContentError(encoded: string): ContentError {
  const envelope = decode<ErrorEnvelope>(encoded);
  const details = diagnosticGraph(
    envelope.error,
    new Set(envelope.causes),
    true,
  ) as ErrorEnvelope["error"];
  const error = new ContentError(details);
  error.stack = details.stack;
  return error;
}
