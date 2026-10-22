import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedConfig } from "vite-plus";
import { describe, expect, test } from "vite-plus/test";
import { forbidden } from "./client-boundary.ts";

const packageRoot = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));

/** Builds the resolved configuration fields the boundary reads. */
function config(root: string): ResolvedConfig {
  return { root, build: { ssr: false } } as unknown as ResolvedConfig;
}

describe("forbidden", () => {
  test("allows application modules whose own path contains content-query/src", () => {
    const root = "/work/content-query";
    expect(forbidden("/work/content-query/src/main.tsx", config(root), {})).toBe(false);
    expect(forbidden("./src/App.tsx", config(root), {}, "/work/content-query/index.html")).toBe(
      false,
    );
    expect(forbidden("/work/apps/content-query/dist/client.js", config(root), {})).toBe(false);
  });
  test("rejects the installed package, any content-query dependency copy, and server entries", () => {
    const app = config("/work/app");
    for (const source of [
      path.join(packageRoot, "dist/runtime.mjs"),
      path.join(packageRoot, "src/runtime/content.ts"),
      "/work/app/node_modules/content-query/dist/index.mjs",
      "/work/app/node_modules/.pnpm/content-query@1.0.0/node_modules/content-query/dist/query.mjs",
      "/work/app/.content-query/server.js",
      "/work/app/content-query.config.ts",
      "content-query/query",
      "content-query:server",
      "content-query:mdx:server",
    ]) {
      expect(forbidden(source, app, {}), source).toBe(true);
    }
    expect(forbidden("react", app, {})).toBe(false);
  });
});
