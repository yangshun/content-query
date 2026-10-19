import path from "node:path";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import type { ResolvedConfig } from "vite-plus";
import type { BuildContentOptions } from "../../preparation/build.ts";
import { configCandidates } from "../../preparation/config-path.ts";
import { virtualPrefix, clientFacade, clientModule } from "./modules.ts";
import { withinDirectory } from "../../shared/paths.ts";

/** Locates this installed package, so application paths named "content-query" never match it. */
function packageDirectory(): string | undefined {
  try {
    return path.dirname(
      realpathSync(createRequire(import.meta.url).resolve("content-query/package.json")),
    );
  } catch {
    return undefined;
  }
}
const installed = packageDirectory();

/** Detects the consuming environment before any server module is loaded. */
export function clientEnvironment(
  context: unknown,
  config: ResolvedConfig,
  ssr?: boolean,
): boolean {
  const environment = (
    context as { environment?: { config?: { consumer?: string }; name?: string } }
  ).environment;
  return environment?.config?.consumer
    ? environment.config.consumer === "client"
    : environment?.name
      ? environment.name === "client"
      : !ssr && !config.build.ssr;
}
/** Resolves physical paths without relying on a server entry's import spelling. */
export function physicalPath(source: string, config: ResolvedConfig, importer?: string): string {
  const cleaned = source.split("?")[0]!;
  return cleaned.startsWith(".")
    ? path.resolve(importer ? path.dirname(importer) : config.root, cleaned)
    : path.isAbsolute(cleaned)
      ? cleaned
      : "";
}
/** Identifies build/runtime dependencies that must never enter a client graph. */
export function forbidden(
  source: string,
  config: ResolvedConfig,
  options: Pick<BuildContentOptions, "config" | "outDir">,
  importer?: string,
): boolean {
  if (source === clientFacade || source === clientModule) {
    return false;
  }
  if (
    source.startsWith("content-query:") ||
    source.startsWith("virtual:content-query/") ||
    source.startsWith(virtualPrefix) ||
    /^content-query(?:\/|$)/.test(source)
  ) {
    return true;
  }
  const filename = physicalPath(source, config, importer).replace(/\\/g, "/");
  if (!filename) {
    return false;
  }
  const configPaths = configCandidates(config.root, options.config).map((filename) =>
    filename.replace(/\\/g, "/"),
  );
  const outputPath = path
    .resolve(config.root, options.outDir ?? "./.content-query")
    .replace(/\\/g, "/");
  return (
    configPaths.includes(filename) ||
    filename.startsWith(`${outputPath}/`) ||
    filename.includes("/node_modules/content-query/") ||
    (installed !== undefined &&
      ["dist", "src"].some((directory) =>
        withinDirectory(path.join(installed, directory), filename),
      ))
  );
}
