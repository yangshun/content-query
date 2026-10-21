import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { apps, benchmarkRoot, appDirectory, workload, type Phase } from "./config.ts";
import { clearCaches, measureSample, type Sample } from "./measure.ts";
import { environment, stopAllProcesses } from "./process.ts";
import { defaultSettle, waitForQuietHost } from "./host.ts";

const { values } = parseArgs({
  options: {
    label: { type: "string", default: "local" },
    mode: { type: "string", default: "trace" },
    runs: { type: "string", default: "1" },
    phase: { type: "string", default: "all" },
    backend: { type: "string", default: "in-memory" },
  },
});
if (!/^[a-z0-9][a-z0-9_-]*$/.test(values.label)) {
  throw new Error("--label must contain lowercase letters, digits, underscores, or hyphens.");
}
if (!["timings", "trace", "cpu"].includes(values.mode)) {
  throw new Error("--mode must be timings, trace, or cpu.");
}
if (!["all", "startup", "build"].includes(values.phase)) {
  throw new Error("--phase must be all, startup, or build.");
}
if (!["generated", "in-memory"].includes(values.backend)) {
  throw new Error("--backend must be generated or in-memory.");
}
environment.CONTENT_QUERY_BENCH_BACKEND = values.backend;
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || process.versions.node !== "24.21.0") {
  throw new Error("Use Node 24.21.0 and a positive integer --runs.");
}
const app = apps.find((app) => app.id === "void")!;
const corpus = JSON.parse(
  await readFile(path.join(benchmarkRoot, ".fixtures/manifest.json"), "utf8"),
);
const artifacts = path.resolve(benchmarkRoot, "../packages/content-query/dist");
/** Detects rebuilt package code during a measurement sequence. */
async function fingerprintArtifacts(directory = artifacts): Promise<string> {
  const hash = createHash("sha256");
  for (const filename of (await readdir(directory, { recursive: true }))
    .filter((file) => file.endsWith(".mjs"))
    .sort()) {
    hash
      .update(filename)
      .update("\0")
      .update(await readFile(path.join(directory, filename)))
      .update("\0");
  }
  return hash.digest("hex");
}
const voidPackage = await realpath(path.join(benchmarkRoot, "apps/void/node_modules/void"));
const reactPackage = await realpath(path.join(benchmarkRoot, "apps/void/node_modules/@void/react"));
const report = {
  workload,
  startedAt: new Date().toISOString(),
  label: values.label,
  mode: values.mode,
  backend: values.backend,
  node: process.version,
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  memoryBytes: os.totalmem(),
  platform: `${os.platform()} ${os.arch()} ${os.release()}`,
  loadAverageAtStart: os.loadavg(),
  lockfileSha256: createHash("sha256")
    .update(await readFile(path.resolve(benchmarkRoot, "../pnpm-lock.yaml")))
    .digest("hex"),
  corpus,
  contentQueryArtifactsSha256: await fingerprintArtifacts(),
  voidArtifactsSha256: await fingerprintArtifacts(path.join(voidPackage, "dist")),
  reactArtifactsSha256: await fingerprintArtifacts(path.join(reactPackage, "dist")),
  reactArtifactsUnchanged: undefined as boolean | undefined,
  voidPackage: path.relative(benchmarkRoot, voidPackage),
  voidArtifactsUnchanged: undefined as boolean | undefined,
  contentQueryArtifactsUnchanged: undefined as boolean | undefined,
  samples: [] as Sample[],
  completedAt: undefined as string | undefined,
  loadAverageAtEnd: undefined as number[] | undefined,
};
const root = path.join(benchmarkRoot, ".runs/profiles", values.label);
const output = path.join(benchmarkRoot, "results", `profile-${values.label}.json`);
await mkdir(root, { recursive: true });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopAllProcesses().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}
const browser = await chromium.launch({ headless: true });
try {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  const phases: Phase[] = values.phase === "all" ? ["startup", "build"] : [values.phase as Phase];
  for (let repetition = 1; repetition <= runs; repetition++) {
    for (const phase of phases) {
      await clearCaches(appDirectory(benchmarkRoot, app));
      for (const cache of ["cold", "warm"] as const) {
        const directory = path.join(root, `${repetition}-${phase}-${cache}`);
        if (values.mode !== "timings") {
          environment.NODE_OPTIONS =
            `${process.env.NODE_OPTIONS ?? ""} --import=${path.join(benchmarkRoot, "scripts/profile-hook.mjs")}`.trim();
          environment.CONTENT_QUERY_PROFILE_DIRECTORY = directory;
          environment.CONTENT_QUERY_PROFILE_CPU = values.mode === "cpu" ? "1" : "0";
        }
        console.log(`${values.label}: ${repetition}/${runs} ${phase} ${cache} (${values.mode})`);
        const host = await waitForQuietHost(defaultSettle);
        console.log(
          `Host ${(host.idle * 100).toFixed(0)}% idle${host.settled ? "" : " (did not settle)"}`,
        );
        const sample = await measureSample(
          browser,
          app,
          benchmarkRoot,
          corpus.entries,
          phase,
          cache,
          repetition,
          path.join(directory, "output.log"),
        );
        sample.host = host;
        report.samples.push(sample);
        await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify(sample));
      }
    }
  }
  report.completedAt = new Date().toISOString();
  report.contentQueryArtifactsUnchanged =
    (await fingerprintArtifacts()) === report.contentQueryArtifactsSha256;
  report.voidArtifactsUnchanged =
    (await fingerprintArtifacts(path.join(voidPackage, "dist"))) === report.voidArtifactsSha256;
  report.reactArtifactsUnchanged =
    (await fingerprintArtifacts(path.join(reactPackage, "dist"))) === report.reactArtifactsSha256;
  report.loadAverageAtEnd = os.loadavg();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
  await stopAllProcesses();
}
if (
  report.samples.some((sample) => sample.status !== "success") ||
  report.contentQueryArtifactsUnchanged === false ||
  report.voidArtifactsUnchanged === false ||
  report.reactArtifactsUnchanged === false
) {
  process.exitCode = 1;
}
