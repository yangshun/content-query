import { ContentError, payloadIdentity, type ContentDiagnostic } from "../../shared/errors.ts";

/** Names where a diagnostic applies: collection, entry, source, payload variant, and field path. */
function location(diagnostic: ContentDiagnostic): string {
  return [
    diagnostic.collection,
    diagnostic.id,
    diagnostic.source,
    diagnostic.payload ? payloadIdentity(diagnostic.payload, diagnostic.variant) : undefined,
    diagnostic.path?.length ? `at ${diagnostic.path.map(String).join(".")}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Prints structured contextual diagnostics without depending on a framework display. */
export function report(cause: unknown): void {
  if (cause instanceof ContentError) {
    for (const diagnostic of cause.diagnostics) {
      console.error(
        `[content-query:${diagnostic.code}] ${location(diagnostic)}: ${diagnostic.message}`,
      );
    }
  } else {
    console.error(cause instanceof Error ? cause.message : cause);
  }
}
