export type ContentErrorCode =
  | "entry-not-found"
  | "not-renderable"
  | "source-error"
  | "validation-error"
  | "duplicate-id"
  | "invalid-reference"
  | "invalid-query"
  | "artifact-error"
  | "render-error";
export type ContentDiagnostic = {
  code: ContentErrorCode;
  message: string;
  operation?: string;
  collection?: string;
  id?: string;
  source?: string;
  path?: readonly PropertyKey[];
  issues?: readonly unknown[];
  cause?: unknown;
};
const contentErrorBrand = Symbol.for("content-query.error");

/** A contextual library failure; inspect code and diagnostics instead of message text. */
export class ContentError extends Error {
  /** Recognizes contextual errors across preparation and separately bundled loader modules. */
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === "object" &&
      (value as { [contentErrorBrand]?: unknown })[contentErrorBrand] === true
    );
  }
  readonly code: ContentErrorCode;
  readonly operation?: string;
  readonly collection?: string;
  readonly id?: string;
  readonly source?: string;
  readonly path?: readonly PropertyKey[];
  readonly issues?: readonly unknown[];
  readonly diagnostics: readonly ContentDiagnostic[];

  /** Creates one failure or a grouped report preserving individual causes and issues. */
  constructor(options: ContentDiagnostic & { diagnostics?: readonly ContentDiagnostic[] }) {
    super(options.message, { cause: options.cause });
    Object.defineProperty(this, contentErrorBrand, { value: true });
    this.name = "ContentError";
    this.code = options.code;
    this.operation = options.operation;
    this.collection = options.collection;
    this.id = options.id;
    this.source = options.source;
    this.path = options.path;
    this.issues = options.issues;
    this.diagnostics = options.diagnostics ?? [{ ...options }];
  }
}

/** Rejects invalid query structure before any execution or payload access. */
export function invalidQuery(message: string): never {
  throw new ContentError({ code: "invalid-query", operation: "query", message });
}

/** Converts an acquisition/processing failure without discarding contextual library errors. */
export function contentError(cause: unknown, context: ContentDiagnostic): ContentError {
  return cause instanceof ContentError ? cause : new ContentError({ ...context, cause });
}

/** Describes a foreign failure for diagnostic text while its original remains the cause. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Groups independent diagnostics under the primary code while preserving every report. */
export function groupDiagnostics(diagnostics: readonly ContentDiagnostic[]): ContentError {
  return new ContentError({
    ...diagnostics[0]!,
    diagnostics,
    message: diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
  });
}

/** Adds missing operation/collection context to each diagnostic, keeping codes and causes. */
export function withContext(cause: unknown, context: ContentDiagnostic): ContentError {
  const error =
    cause instanceof ContentError
      ? cause
      : new ContentError({
          ...context,
          message: `${context.message}: ${describeCause(cause)}`,
          cause,
        });
  return groupDiagnostics(
    error.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      operation: diagnostic.operation ?? context.operation,
      collection: diagnostic.collection ?? context.collection,
    })),
  );
}
