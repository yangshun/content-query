import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/** Builds the consumer package before any parallel fixture can import its exports. */
export default async function setup(): Promise<void> {
  await promisify(execFile)("vp", ["pack"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  });
}
