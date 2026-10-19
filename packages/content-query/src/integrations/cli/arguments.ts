import { cac, type Command } from "cac";
import packageInfo from "../../../package.json" with { type: "json" };
import type { BuildContentOptions } from "../../build.ts";

/** Validates one path option after CAC's automatic numeric conversion. */
function pathOption(value: unknown, flag: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") {
    throw new Error(`Invalid value for ${flag}; expected a path.`);
  }
  return String(value);
}

/** Rejects repeated build options, including aliases that CAC otherwise collapses. */
function assertSingleOptions(command: Command, arguments_: string[]): void {
  const used = new Set<string>();
  for (const argument of arguments_) {
    const name = argument.split("=", 1)[0]!;
    const flags = name.startsWith("--")
      ? [name.slice(2).replace(/^no-/, "")]
      : name.startsWith("-")
        ? name.slice(1).split("")
        : [];
    for (const flag of flags) {
      const option = command.hasOption(flag);
      if (option) {
        if (used.has(option.name)) {
          throw new Error(`Repeated option: --${option.name}`);
        }
        used.add(option.name);
      }
    }
  }
}

/** Applies ContentQuery's scalar option and backend contracts to CAC's parsed values. */
function buildOptions(options: Record<string, unknown>): BuildContentOptions {
  if (Array.isArray(options["--"]) && options["--"].length > 0) {
    throw new Error("Unexpected arguments after --.");
  }
  const { config, backend, outDir, watch } = options;
  if (backend !== undefined && backend !== "generated" && backend !== "in-memory") {
    throw new Error(`Invalid backend: ${JSON.stringify(backend)}`);
  }
  if (watch !== undefined && typeof watch !== "boolean") {
    throw new Error("Invalid value for --watch; expected a boolean.");
  }
  return {
    ...(config === undefined ? {} : { config: pathOption(config, "--config") }),
    ...(backend === undefined ? {} : { backend }),
    ...(outDir === undefined ? {} : { outDir: pathOption(outDir, "--out-dir") }),
    ...(watch === undefined ? {} : { watch }),
  };
}

/** Parses build options with CAC, or prints help/version and returns no build request. */
export function parseArguments(arguments_: string[]): BuildContentOptions | undefined {
  const cli = cac("content-query");
  let options: BuildContentOptions | undefined;
  const command = cli.command("build", "Build content collections for server-side queries");
  command
    .option("-c, --config <file>", "Use an exact configuration file")
    .option("--backend <name>", "Storage backend: generated (default) or in-memory")
    .option("-o, --out-dir <directory>", "Output directory (default: .content-query)")
    .option("-w, --watch", "Watch sources and rebuild after changes")
    .action((parsed: Record<string, unknown>) => {
      assertSingleOptions(command, arguments_);
      options = buildOptions(parsed);
    });
  cli.help().version(packageInfo.version);
  cli.parse([process.execPath, "content-query", ...arguments_], { run: false });
  if (cli.options.version && cli.matchedCommand) {
    cli.outputVersion();
  }
  if (cli.options.help || cli.options.version) {
    return undefined;
  }
  if (!cli.matchedCommand) {
    throw new Error("Usage: content-query build [options]. Run content-query --help for details.");
  }
  cli.runMatchedCommand();
  return options;
}
