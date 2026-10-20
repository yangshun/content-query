import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { benchmarkRoot } from "./config.ts";

export type CpuProfile = {
  nodes: { id: number; callFrame: { functionName: string; url: string }; children?: number[] }[];
  samples: number[];
  timeDeltas: number[];
};

/** Extracts source graph and emitted-module counts from the native Void build log. */
export function buildStructure(log: string) {
  const clean = stripVTControlCharacters(log);
  const transformed = [...clean.matchAll(/(\d+) modules transformed/g)].map((match) =>
    Number(match[1]),
  );
  if (!transformed.length) {
    return undefined;
  }
  const assets = clean.split(/[\r\n]+/).flatMap((line) => {
    const match = /^dist\/ssr\/assets\/(\S+\.js)(?:\s|$)/.exec(line);
    return match ? [match[1]!] : [];
  });
  return {
    serverModulesTransformed: transformed[0],
    clientModulesTransformed: transformed[1],
    serverAssetJsFiles: assets.length,
    hashedEntryJsFiles: assets.filter((name) => /^[a-f0-9]{64}-/.test(name)).length,
    outputPayloadGroupJsFiles: assets.filter((name) => name.startsWith("content-query-payloads-"))
      .length,
  };
}

/** Attributes V8 sample deltas to self and inclusive stacks, counting recursion once per frame key. */
export function summarizeCpu(profile: CpuProfile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map(
    profile.nodes.flatMap((node) =>
      (node.children ?? []).map((child) => [child, node.id] as const),
    ),
  );
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  let total = 0;
  let idle = 0;
  for (const [index, identifier] of profile.samples.entries()) {
    const delta = profile.timeDeltas[index] ?? 0;
    total += delta;
    let current: number | undefined = identifier;
    const seen = new Set<string>();
    while (current !== undefined) {
      const node = nodes.get(current);
      if (!node) {
        break;
      }
      const { functionName, url } = node.callFrame;
      const key = JSON.stringify([functionName, url]);
      if (current === identifier) {
        self.set(key, (self.get(key) ?? 0) + delta);
        if (functionName === "(idle)") {
          idle += delta;
        }
      }
      if (!seen.has(key)) {
        inclusive.set(key, (inclusive.get(key) ?? 0) + delta);
        seen.add(key);
      }
      current = parents.get(current);
    }
  }
  const active = total - idle;
  /** Keeps dependency paths readable without machine-specific package-store identifiers. */
  function top(counter: Map<string, number>) {
    return [...counter]
      .sort((left, right) => right[1] - left[1])
      .map(([key, duration]) => {
        const [name, url] = JSON.parse(key) as [string, string];
        return {
          name,
          source: url.includes("/node_modules/")
            ? url.split("/node_modules/").at(-1)
            : url.replace(path.resolve(benchmarkRoot, "../.."), "<repo>"),
          durationMs: duration / 1000,
          activePercent: active ? (duration / active) * 100 : 0,
        };
      })
      .filter(({ name }) => name !== "(root)" && name !== "(idle)")
      .slice(0, 25);
  }
  return {
    sampledMs: total / 1000,
    activeMs: active / 1000,
    idleMs: idle / 1000,
    self: top(self),
    inclusive: top(inclusive),
  };
}

if (import.meta.main) {
  const directory = path.resolve(benchmarkRoot, process.argv[2] ?? ".runs/profiles/local-cpu");
  const output = path.resolve(benchmarkRoot, process.argv[3] ?? "results/profile-attribution.json");
  const traces = [];
  for (const filename of (await readdir(directory, { recursive: true }))
    .filter((file) => file.endsWith(".json"))
    .sort()) {
    const source = path.join(directory, filename);
    const trace = JSON.parse(await readFile(source, "utf8"));
    if (!trace.spans || !Object.keys(trace.spans).length) {
      continue;
    }
    let cpu;
    try {
      cpu = summarizeCpu(
        JSON.parse(await readFile(source.replace(/\.json$/, ".cpuprofile"), "utf8")),
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        throw cause;
      }
    }
    const build = buildStructure(
      await readFile(path.join(path.dirname(source), "output.log"), "utf8"),
    );
    traces.push({ file: path.relative(benchmarkRoot, source), ...trace, cpu, build });
  }
  await writeFile(
    output,
    `${JSON.stringify({ note: "Instrumented diagnostics; use timings mode for wall-clock comparisons.", traces }, null, 2)}\n`,
  );
  console.log(
    `Summarized ${traces.length} processes into ${path.relative(benchmarkRoot, output)}.`,
  );
}
