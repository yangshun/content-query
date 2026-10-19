import path from "node:path";
import { writeArtifacts } from "../artifacts/write.ts";
import { ContentError } from "../shared/errors.ts";
import { createSession, type ContentSession } from "./session.ts";
import { assertServerOnly } from "../shared/server-only.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { InvalidRelationships } from "../collection/registry-types.ts";
import { canonicalPath, withinDirectory } from "../shared/paths.ts";
import { resolveConfigPath } from "./config-path.ts";

assertServerOnly();
export type { ContentSession } from "./session.ts";
/** Options shared by standalone content builds and host integrations. */
export type BuildContentOptions = {
  /** Exact config path; omission discovers one content-query.config.{ts,mts,cts,js,mjs,cjs} file. */
  config?: string;
  backend?: "in-memory" | "generated";
  /** Generated backend output directory, relative to the application root; defaults to ./.content-query. */
  outDir?: string;
  watch?: boolean;
};

/** Builds content independently of a bundler; bind the registry through an erased type import. */
export async function buildContent<Registry extends CollectionRegistry = {}>(
  ...arguments_: InvalidRelationships<Registry> extends never
    ? [options?: BuildContentOptions]
    : [invalidRegistry: never]
): Promise<ContentSession<Registry>> {
  return buildAtRoot<Registry>(process.cwd(), arguments_[0] ?? {});
}

/** Private host entrypoint resolving all configured paths from one application root. */
export async function buildAtRoot<Registry extends CollectionRegistry = {}>(
  root: string,
  options: BuildContentOptions,
  change?: Parameters<typeof createSession>[0]["change"],
): Promise<ContentSession<Registry>> {
  const { backend = "generated", watch = false } = options;
  if (
    !["generated", "in-memory"].includes(backend) ||
    typeof watch !== "boolean" ||
    (options.config !== undefined && typeof options.config !== "string") ||
    (options.outDir !== undefined && typeof options.outDir !== "string")
  ) {
    throw new ContentError({ code: "source-error", message: "Invalid build options." });
  }
  const config = await resolveConfigPath(root, options.config);
  const outDir = path.resolve(root, options.outDir ?? "./.content-query");
  if (backend === "generated") {
    const [physicalRoot, physicalOutput, physicalConfig] = await Promise.all([
      canonicalPath(path.resolve(root)),
      canonicalPath(outDir),
      canonicalPath(config),
    ]);
    if (
      withinDirectory(physicalOutput, physicalRoot) ||
      withinDirectory(physicalOutput, physicalConfig)
    ) {
      throw new ContentError({
        code: "source-error",
        operation: "build",
        message:
          "Generated output must be a dedicated directory outside collection configuration and cannot contain the application root.",
      });
    }
  }
  return createSession<Registry>({
    root,
    config,
    outDir,
    watch,
    change,
    publish:
      backend === "generated"
        ? (revision, _registry, signal) =>
            writeArtifacts(revision, outDir, config, { signal, prune: !watch })
        : undefined,
  });
}
