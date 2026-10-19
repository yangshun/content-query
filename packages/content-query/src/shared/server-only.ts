/** Provides a fallback when a host has not rejected a server import during bundling. */
export function assertServerOnly(): void {
  if ((globalThis as { window?: unknown }).window !== undefined) {
    throw new Error("[content-query] Content querying and preparation are server-only.");
  }
}
