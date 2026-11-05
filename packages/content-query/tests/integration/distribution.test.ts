import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import config from "../../vite.config.ts";
import { packageRoot } from "../helpers/project.ts";

const execute = promisify(execFile);
const distribution = path.join(packageRoot, "dist");

/** Lists the static, re-exported, and dynamic import specifiers in a built module. */
function importSpecifiers(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map(
    (match) => match[1]!,
  );
}

/** Lists every built JavaScript module, including nested entries such as `internal/markdown`. */
async function builtModules(): Promise<string[]> {
  const files = await readdir(distribution, { recursive: true });
  return files.filter((file) => file.endsWith(".mjs"));
}

/** Reads the `deps.alwaysBundle` patterns that the package build is configured with. */
function alwaysBundlePatterns(): (string | RegExp)[] {
  const pack = [config.pack].flat()[0];
  return [pack?.deps?.alwaysBundle]
    .flat()
    .filter((pattern) => typeof pattern === "string" || pattern instanceof RegExp);
}

/** Matches a specifier against a pattern, treating a bare name as covering its subpaths too. */
function isCoveredBy(specifier: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return specifier === pattern || specifier.startsWith(`${pattern}/`);
  }
  pattern.lastIndex = 0;
  return pattern.test(specifier);
}

describe("built distribution", () => {
  test("inlines always-bundled dependencies, including subpath imports", async () => {
    const patterns = alwaysBundlePatterns();
    expect(patterns.length).toBeGreaterThan(0);
    const leaked: string[] = [];
    for (const file of await builtModules()) {
      const code = await readFile(path.join(distribution, file), "utf8");
      for (const specifier of importSpecifiers(code)) {
        if (patterns.some((pattern) => isCoveredBy(specifier, pattern))) {
          leaked.push(`${file} imports ${specifier}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  test("loads every entry when Node does not detect module syntax", async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    // The CLI entry runs the command line on import; the package tests execute it separately.
    const specifiers = Object.keys(manifest.exports)
      .filter((subpath) => subpath !== "./package.json" && subpath !== "./cli")
      .map((subpath) => path.posix.join(manifest.name, subpath));
    expect(specifiers).toContain("content-query/internal");
    const script = `const failures = [];
for (const specifier of ${JSON.stringify(specifiers)}) {
  try {
    await import(specifier);
  } catch (cause) {
    failures.push(specifier + ": " + cause.message);
  }
}
console.log(JSON.stringify(failures));`;
    // Hosts without module syntax detection treat ambiguous `.js` dependencies as CommonJS.
    const result = await execute(
      process.execPath,
      ["--no-experimental-detect-module", "--input-type=module", "-e", script],
      { cwd: packageRoot },
    );
    expect(JSON.parse(result.stdout)).toEqual([]);
  }, 30_000);
});
