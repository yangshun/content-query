import { ContentError } from "../../shared/errors.ts";

/** Prints structured contextual diagnostics without depending on a framework display. */
export function report(cause: unknown): void {
  if (cause instanceof ContentError) {
    for (const diagnostic of cause.diagnostics) {
      console.error(
        `[content-query:${diagnostic.code}] ${[diagnostic.collection, diagnostic.id, diagnostic.source].filter(Boolean).join(" ")}: ${diagnostic.message}`,
      );
    }
  } else {
    console.error(cause instanceof Error ? cause.message : cause);
  }
}
