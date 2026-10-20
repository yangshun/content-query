import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { benchmarkRoot } from "./config.ts";

if (process.versions.node !== "24.21.0") {
  throw new Error("Use Node 24.21.0 for serializer profiling.");
}
const appRequire = createRequire(path.join(benchmarkRoot, "apps/void/package.json"));
const voidRoot = path.dirname(path.dirname(appRequire.resolve("void")));
const cloudflareRequire = createRequire(
  realpathSync(path.resolve(voidRoot, "../@cloudflare/vite-plugin/package.json")),
);
const entry = cloudflareRequire.resolve("miniflare");
const original = "new ArrayBuffer(srcBuffer.byteLength + minSize)";
const replacement =
  "new ArrayBuffer(Math.max(srcBuffer.byteLength * 2, srcBuffer.byteLength + minSize))";

if (process.argv[2] === "--worker") {
  const variant = process.argv[3];
  if (variant === "geometric") {
    registerHooks({
      load(url, context, next) {
        const result = next(url, context);
        if (url !== pathToFileURL(entry).href) {
          return result;
        }
        const source = readFileSync(entry, "utf8");
        if (source.split(original).length !== 2) {
          throw new Error(
            "The installed Miniflare allocator changed; inspect it before profiling.",
          );
        }
        return { ...result, source: source.replace(original, replacement) };
      },
    });
  }
  const imported = await import(pathToFileURL(entry).href);
  const { serializeConfig } = imported.default ?? imported;
  const samples = [];
  for (const count of [100, 1000, 10000]) {
    const config = {
      services: [
        {
          name: "benchmark",
          worker: {
            compatibilityDate: "2026-10-19",
            modules: Array.from({ length: count }, (_, index) => ({
              name: `entry-${index}.js`,
              esModule: `export default ${JSON.stringify(`${index}: ${"x".repeat(1024)}`)};`,
            })),
          },
        },
      ],
    };
    const cpu = process.cpuUsage();
    const start = performance.now();
    const buffer = serializeConfig(config);
    const durationMs = performance.now() - start;
    const used = process.cpuUsage(cpu);
    samples.push({
      count,
      durationMs,
      cpuUserMs: used.user / 1000,
      cpuSystemMs: used.system / 1000,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    });
  }
  console.log(JSON.stringify({ variant, samples, maxRssKiB: process.resourceUsage().maxRSS }));
} else {
  const execute = promisify(execFile);
  const variants = [];
  for (const variant of ["linear", "geometric"]) {
    console.log(`Profiling isolated ${variant} arena growth.`);
    const { stdout } = await execute(process.execPath, [import.meta.filename, "--worker", variant]);
    variants.push(JSON.parse(stdout));
  }
  for (const [index, sample] of variants[0].samples.entries()) {
    if (
      sample.sha256 !== variants[1].samples[index].sha256 ||
      sample.bytes !== variants[1].samples[index].bytes
    ) {
      throw new Error("Arena growth changed the serialized bytes.");
    }
  }
  const version = JSON.parse(
    readFileSync(path.resolve(path.dirname(entry), "../../package.json"), "utf8"),
  ).version;
  const output = path.join(benchmarkRoot, "results/profile-serializer.json");
  await writeFile(
    output,
    `${JSON.stringify({ node: process.version, miniflare: version, workload: "Synthetic workerd configs with 100, 1000, and 10000 distinct 1 KiB JavaScript payload modules; only serialization is timed.", patch: { original, replacement, appliedOnlyInIsolatedChild: true }, identicalBytes: true, variants }, null, 2)}\n`,
  );
  console.log(`Saved ${path.relative(benchmarkRoot, output)}; all serialized bytes match.`);
}
