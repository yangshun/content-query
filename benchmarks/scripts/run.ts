import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { chromium } from "playwright";
import {
  apps,
  appDirectory,
  benchmarkRoot,
  defaultEntries,
  workload,
  type App,
  type Phase,
} from "./config.ts";
import { generateCorpus } from "./generate.ts";
import { clearCaches, measureSample } from "./measure.ts";
import { renderReport, type Report } from "./report.ts";
import { stopAllProcesses } from "./process.ts";

const execute = promisify(execFile);

/** Fingerprints the locally built package, whose unpublished version alone cannot identify it. */
async function contentQueryFingerprint(): Promise<string> {
  const directory = path.resolve(benchmarkRoot, "../packages/content-query/dist");
  const files = (await readdir(directory, { recursive: true }))
    .filter((file) => file.endsWith(".mjs"))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(path.join(directory, file)))
      .update("\0");
  }
  return hash.digest("hex");
}

/** Reads installed frameworks and the overridden bundler for each Vite-based application. */
async function packageVersions(app: App): Promise<Record<string, string>> {
  const directory = appDirectory(benchmarkRoot, app);
  const versions: Record<string, string> = {};
  for (const name of [...app.packages, "vite-plus"]) {
    const manifest = JSON.parse(
      await readFile(path.join(directory, "node_modules", name, "package.json"), "utf8"),
    ) as { version: string };
    versions[name] = manifest.version;
  }
  const { stdout } = await execute("vp", ["--version"], { cwd: directory });
  versions["toolchain"] = stdout.trim();
  if (app.id === "next") {
    // Next ships its own Turbopack bundler and does not resolve Vite for the application build.
    return versions;
  }
  const appRequire = createRequire(path.join(directory, "package.json"));
  let owner = appRequire.resolve("vite-plus/package.json");
  if (app.id === "astro") {
    owner = appRequire.resolve("astro/package.json");
  } else if (app.id === "nuxt") {
    owner = createRequire(appRequire.resolve("nuxt/package.json")).resolve(
      "@nuxt/vite-builder/package.json",
    );
  }
  const bundlerPath = createRequire(owner).resolve(
    app.cli ? "vite/package.json" : "@voidzero-dev/vite-plus-core/package.json",
  );
  const bundler = JSON.parse(await readFile(bundlerPath, "utf8")) as {
    name: string;
    version: string;
  };
  versions[bundler.name] = bundler.version;
  return versions;
}

/** Runs independent cold/warm pairs sequentially and checkpoints raw samples after every trial. */
export async function runBenchmark(options: {
  entries: number;
  runs: number;
  selected: App[];
  phases: Phase[];
}): Promise<Report> {
  if (process.versions.node !== "24.21.0") {
    throw new Error(
      "Run with the pinned runtime: vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench",
    );
  }
  if (!Number.isSafeInteger(options.runs) || options.runs < 1) {
    throw new Error("--runs must be a positive integer.");
  }
  console.log(`Generating ${options.entries} entries per app (excluded from timings).`);
  const corpus = await generateCorpus(benchmarkRoot, options.entries);
  const repository = path.resolve(benchmarkRoot, "../..");
  const [version, revision, status, lockfile] = await Promise.all([
    execute("vp", ["--version"], { cwd: repository }),
    execute("git", ["rev-parse", "HEAD"], { cwd: repository }),
    execute("git", ["status", "--porcelain"], { cwd: repository }),
    readFile(path.join(repository, "pnpm-lock.yaml")),
  ]);
  const packages = Object.fromEntries(
    await Promise.all(apps.map(async (app) => [app.id, await packageVersions(app)])),
  );
  const browser = await chromium.launch({ headless: true });
  const report: Report = {
    workload,
    startedAt: new Date().toISOString(),
    repetitions: options.runs,
    corpus,
    environment: {
      node: process.version,
      platform: os.platform(),
      architecture: os.arch(),
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model ?? "Unknown",
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      vitePlus: version.stdout,
      chromium: browser.version(),
      revision: revision.stdout.trim(),
      dirty: status.stdout.trim().length > 0,
      lockfileSha256: createHash("sha256").update(lockfile).digest("hex"),
      contentQueryArtifactsSha256: await contentQueryFingerprint(),
      packages,
    },
    samples: [],
  };
  const runDirectory = path.join(benchmarkRoot, ".runs", report.startedAt.replaceAll(/[:.]/g, "-"));
  await mkdir(path.join(benchmarkRoot, "results"), { recursive: true });
  const save = async () => {
    await writeFile(
      path.join(benchmarkRoot, "results/latest.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writeFile(path.join(benchmarkRoot, "RESULTS.md"), renderReport(report));
  };
  /** Rejects mixed package versions before recording further measurements. */
  const assertPackageUnchanged = async () => {
    const unchanged = await contentQueryFingerprint()
      .then((fingerprint) => fingerprint === report.environment.contentQueryArtifactsSha256)
      .catch(() => false);
    if (!unchanged) {
      report.contentQueryArtifactsUnchanged = false;
      report.error =
        "The built ContentQuery package changed during measurement. Rebuild it before restarting the benchmark.";
      report.completedAt = new Date().toISOString();
      await save();
      throw new Error(report.error);
    }
  };
  try {
    await save();
    for (let repetition = 1; repetition <= options.runs; repetition++) {
      const offset = (repetition - 1) % options.selected.length;
      const order = [...options.selected.slice(offset), ...options.selected.slice(0, offset)];
      for (const app of order) {
        for (const phase of options.phases) {
          await clearCaches(appDirectory(benchmarkRoot, app));
          for (const cache of ["cold", "warm"] as const) {
            await assertPackageUnchanged();
            console.log(`[${repetition}/${options.runs}] ${app.id}: ${cache} ${phase}`);
            const log = path.join(runDirectory, `${repetition}-${app.id}-${phase}-${cache}.log`);
            const sample = await measureSample(
              browser,
              app,
              benchmarkRoot,
              corpus.entries,
              phase,
              cache,
              repetition,
              log,
            );
            report.samples.push(sample);
            await assertPackageUnchanged();
            console.log(
              sample.status === "success"
                ? `  ${(sample.durationMs! / 1_000).toFixed(3)} s${sample.listenMs === undefined ? "" : ` (listening ${(sample.listenMs / 1_000).toFixed(3)} s)`}`
                : `  ${sample.status}: ${sample.error}`,
            );
            await save();
          }
        }
      }
    }
    report.contentQueryArtifactsUnchanged =
      report.environment.contentQueryArtifactsSha256 === (await contentQueryFingerprint());
    report.completedAt = new Date().toISOString();
    await save();
    return report;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stopAllProcesses().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
  }
  const { values } = parseArgs({
    options: {
      entries: { type: "string", default: String(defaultEntries) },
      runs: { type: "string", default: "3" },
      apps: { type: "string", default: apps.map((app) => app.id).join(",") },
      phase: { type: "string", default: "all" },
    },
  });
  const requested = values.apps.split(",");
  const selected = requested.map((id) => {
    const app = apps.find((candidate) => candidate.id === id);
    if (!app) {
      throw new Error(
        `Unknown app ${id}. Choose ${apps.map((candidate) => candidate.id).join(", ")}.`,
      );
    }
    return app;
  });
  if (!["all", "startup", "build"].includes(values.phase)) {
    throw new Error("--phase must be all, startup, or build.");
  }
  const report = await runBenchmark({
    entries: Number(values.entries),
    runs: Number(values.runs),
    selected,
    phases: values.phase === "all" ? ["startup", "build"] : [values.phase as Phase],
  });
  if (
    !report.contentQueryArtifactsUnchanged ||
    report.samples.some((sample) => sample.status !== "success")
  ) {
    process.exitCode = 1;
  }
}
