import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";

/** Parses one of the built-in data formats without applying collection validation. */
export function parseData(text: string, filename: string): unknown {
  switch (path.extname(filename).toLowerCase()) {
    case ".json":
      return JSON.parse(text);
    case ".yaml":
    case ".yml":
      return parseYaml(text);
    case ".toml":
      return parseToml(text);
    default:
      throw new Error(`Unsupported data extension: ${path.extname(filename)}.`);
  }
}

/** Checks the record boundary before identity normalization or Standard Schema validation. */
export function recordData(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error("Entry metadata must be a record.");
  }
  return value as Record<string, unknown>;
}

/** Follows Astro's deliberate String(value) normalization for transport identities. */
export function coerceIdentity(value: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}
