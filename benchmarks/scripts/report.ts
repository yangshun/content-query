import type { Corpus } from "./generate.ts";
import { stripVTControlCharacters } from "node:util";
import { apps, workload } from "./config.ts";
import type { SettleOptions } from "./host.ts";
import type { Sample } from "./measure.ts";

export type Report = {
  workload: typeof workload;
  startedAt: string;
  completedAt?: string;
  contentQueryArtifactsUnchanged?: boolean;
  error?: string;
  repetitions: number;
  corpus: Corpus;
  environment: {
    node: string;
    platform: string;
    architecture: string;
    osRelease: string;
    cpu: string;
    logicalCpus: number;
    memoryBytes: number;
    vitePlus: string;
    chromium: string;
    revision: string;
    dirty: boolean;
    lockfileSha256: string;
    contentQueryArtifactsSha256: string;
    voidBuild?: {
      directory: string;
      sha256: string;
      revision?: string;
      dirty?: boolean;
      reactDirectory?: string;
      reactSha256?: string;
    };
    packages: Record<string, Record<string, string>>;
  };
  /** Measurement controls; absent from reports recorded before they existed. */
  control?: {
    seed: number;
    /** Application IDs in the order measured, one list per repetition. */
    orders: string[][];
    settle: SettleOptions;
    /** Whether Spotlight indexed new files under the applications directory; `null` if unknown. */
    spotlightIndexesApps: boolean | null;
  };
  samples: Sample[];
};

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/** Describes app ordering, the pre-sample settle gate, and samples that started on a busy host. */
function renderControl(report: Report): string[] {
  const control = report.control;
  if (!control) {
    return ["Measurement controls were not recorded for this run."];
  }
  const { threshold, windows, windowMs, timeoutMs } = control.settle;
  const observed = report.samples.flatMap((sample) => (sample.host ? [sample.host] : []));
  const unsettled = report.samples.filter((sample) => sample.host && !sample.host.settled);
  const idle = statistics(observed.map((host) => host.idle));
  const waited = statistics(observed.map((host) => host.waitedMs));
  const lines = [
    `App order was shuffled independently for each repetition with seed \`${control.seed}\`:`,
    "",
    ...control.orders.map((order, index) => `${index + 1}. ${order.join(", ")}`),
    "",
    `Before every sample, the runner waited until host CPU was at least ${percent(threshold)} idle, averaged over ${windows} consecutive ${windowMs / 1_000}-second windows, for up to ${timeoutMs / 1_000} seconds. ${observed.length - unsettled.length}/${observed.length} samples started on a settled host.${idle && waited ? ` Median idle before a sample: ${percent(idle.median)} (${percent(idle.min)}–${percent(idle.max)}); median wait: ${(waited.median / 1_000).toFixed(1)} s (maximum ${(waited.max / 1_000).toFixed(1)} s).` : ""}`,
    "",
    control.spotlightIndexesApps === null
      ? "Spotlight indexing of application output could not be determined."
      : control.spotlightIndexesApps
        ? "Spotlight indexed new files under the applications directory during this run. Indexing competes with stacks in proportion to the files they write; add the directory to Spotlight's privacy list to exclude it."
        : "Spotlight did not index new files under the applications directory during this run.",
  ];
  if (unsettled.length) {
    lines.push("", "Samples that started before the host settled:", "");
    for (const sample of unsettled) {
      lines.push(
        `- ${sample.app}, ${sample.phase}, ${sample.cache}, repetition ${sample.repetition}: ${percent(sample.host!.idle)} idle; load average ${sample.host!.loadAverage.map((value) => value.toFixed(2)).join(", ")}.`,
      );
    }
  }
  return lines;
}

/** Summarizes only supplied successful values, retaining an honest empty result for failures. */
export function statistics(
  values: number[],
): { median: number; min: number; max: number; count: number } | null {
  if (!values.length) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { median, min: sorted[0]!, max: sorted.at(-1)!, count: sorted.length };
}

function format(values: number[], expected: number): string {
  const summary = statistics(values);
  if (!summary) {
    return "Failed / pending";
  }
  return `${(summary.median / 1_000).toFixed(2)} (${(summary.min / 1_000).toFixed(2)}–${(summary.max / 1_000).toFixed(2)}; n=${summary.count}/${expected})`;
}

/** Produces a self-contained results table with workload, cache, environment, and failure context. */
export function renderReport(report: Report): string {
  const requested = report.control ? new Set(report.control.orders.flat()) : undefined;
  const selectedApps = apps.filter((app) => !requested || requested.has(app.id));
  const passed = report.samples.filter((sample) => sample.status === "success");
  const builds = report.samples.filter((sample) => sample.phase === "build");
  const verifiedBuilds = builds.filter(
    (sample) =>
      sample.status === "success" && sample.prerenderedPages === report.corpus.entries + 1,
  );
  const lines = [
    "# ContentQuery full-site benchmarks",
    "",
    `Run: ${report.startedAt}. ${report.completedAt ? `Completed: ${report.completedAt}.` : "Run in progress; the table may be incomplete."}`,
    ...(report.error ? ["", `**Run aborted; these timings are invalid:** ${report.error}`] : []),
    "",
    `${report.corpus.entries.toLocaleString("en-US")} unique Markdown entries, ${report.corpus.bytes.toLocaleString("en-US")} bytes total, shared across benchmark apps (${report.corpus.hardlinks} hardlinks, ${report.corpus.copies} copies). Corpus SHA-256: \`${report.corpus.sha256}\`.`,
    "",
    `Workload: \`${report.workload}\`. Each homepage lists every title and description with a link. Every entry has a dedicated prerendered article: ${(report.corpus.entries + 1).toLocaleString("en-US")} content HTML pages per successful build. Native error pages and auxiliary assets are additional output.`,
    "",
    `Selected stacks: ${selectedApps.map((app) => app.label).join(", ")}.`,
    ...(report.samples.length
      ? [
          "",
          `Validation: ${passed.length}/${report.samples.length} recorded samples passed. ${verifiedBuilds.length}/${builds.length} recorded production builds emitted and verified every content HTML page. Failed samples are excluded from timing summaries.`,
        ]
      : []),
    "",
    "The [historical single-page report](./results/single-page-RESULTS.md) and [raw samples](./results/single-page.json) cover the previous workload and are not directly comparable.",
    "",
    "## Timings",
    "",
    "Seconds, shown as median (minimum–maximum; successful samples / requested samples). Startup includes the full homepage and the first and last dedicated articles. Production builds prerender every item page.",
    "",
  ];
  const timingOrder = ["void", "astro", "tanstack-start", "vite-react", "nuxt", "next"] as const;
  for (const cache of ["cold", "warm"] as const) {
    lines.push(
      `### ${cache === "cold" ? "Cold" : "Warm"}`,
      "",
      "| Stack | Content usable | Production build |",
      "| --- | ---: | ---: |",
    );
    for (const id of timingOrder) {
      const app = apps.find((candidate) => candidate.id === id)!;
      if (requested && !requested.has(id)) {
        continue;
      }
      const selected = report.samples.filter(
        (sample) => sample.app === app.id && sample.cache === cache && sample.status === "success",
      );
      const startup = selected.filter((sample) => sample.phase === "startup");
      const builds = selected.filter((sample) => sample.phase === "build");
      lines.push(
        `| ${app.label} | ${format(
          startup.flatMap((sample) => (sample.durationMs === undefined ? [] : [sample.durationMs])),
          report.repetitions,
        )} | ${format(
          builds.flatMap((sample) => (sample.durationMs === undefined ? [] : [sample.durationMs])),
          report.repetitions,
        )} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "",
    "## Method",
    "",
    `- Three cold/warm pairs by default; ${selectedApps.length} requested stacks in this run. Only one framework and measurement type (startup or build) runs at a time, in a seeded random app order per repetition. Each server, build, and validation preview is shut down before the next sample starts. No Vite task-result cache is used.`,
    "- Before every sample, the runner waits for host CPU to become idle, so background work triggered by earlier samples, such as file indexing of tens of thousands of emitted pages, does not overlap the next measurement. Host state before each sample is recorded in the raw results.",
    "- Cold means application content/framework/build and local dependency-optimizer caches are removed. OS filesystem caches remain warm, especially because the inputs are hardlinked. This is not a machine cold-boot benchmark.",
    "- Startup uses a prelaunched Chromium with a fresh browser context and page. Timing begins immediately before spawning the dev command. TCP readiness does not request the app. Content usability verifies every homepage title, description, and item link, then directly loads the first and last articles and verifies their own metadata and rendered Markdown.",
    "- Build timing ends at successful command completion, including content processing, bundling, route enumeration, and all item prerendering. Outside the build timer, validation audits every emitted item HTML file and the complete homepage, then serves and checks the output in Chromium. A client shell, missing page, or article with another item's body fails validation and excludes the sample.",
    "- Dependency installation, ContentQuery package compilation, corpus generation, browser launch, cache cleanup, and shutdown are excluded from timings. Startup timeout: five minutes; build timeout: ten minutes.",
    "- Inputs are plain Markdown with no images, code fences, or custom plugins. Native content processing defaults are retained. Nuxt uses Node's native SQLite connector.",
    "- Astro uses getStaticPaths(), Nuxt uses nuxt generate with link crawling, Void uses getPrerenderPaths(), Next.js uses generateStaticParams() with output: export, and TanStack Start uses its native prerender link crawler. Vite + React uses a small Vite SSR/SSG build script; both browser and server compilation and rendering every page are included in its build timer.",
    "- Results compare complete application stacks under this workspace's Vite+ configuration. Next.js uses its native Turbopack bundler; Vite-based stacks inherit the workspace dependency overrides. Every command runs through the app's own Vite+ CLI, so each stack uses the toolchain version it declares. All apps produce a full static content site; their JavaScript hydration, data payloads, content artifacts, and build machinery differ. ContentQuery's Next.js adapter uses generated artifacts; its Vite adapter defaults to in-memory storage.",
    "",
    "## Order and host load",
    "",
    ...renderControl(report),
    "",
    "## Environment",
    "",
    `- Node: ${report.environment.node}; Chromium: ${report.environment.chromium}.`,
    `- System: ${report.environment.platform} ${report.environment.architecture}, OS ${report.environment.osRelease}.`,
    `- CPU: ${report.environment.cpu}; ${report.environment.logicalCpus} logical CPUs; ${(report.environment.memoryBytes / 1024 ** 3).toFixed(1)} GiB RAM.`,
    `- Git revision: \`${report.environment.revision}\`; uncommitted changes: ${report.environment.dirty}.`,
    `- Lockfile SHA-256: \`${report.environment.lockfileSha256}\`.`,
    `- Built ContentQuery JavaScript SHA-256: \`${report.environment.contentQueryArtifactsSha256}\`${report.contentQueryArtifactsUnchanged === undefined ? "." : `; unchanged during measurement: ${report.contentQueryArtifactsUnchanged}.`}`,
    ...(report.environment.voidBuild
      ? [
          `- Built Void JavaScript SHA-256: \`${report.environment.voidBuild.sha256}\`; package directory: \`${report.environment.voidBuild.directory}\`.${report.environment.voidBuild.revision ? ` Source revision: \`${report.environment.voidBuild.revision}\`; uncommitted package changes: ${report.environment.voidBuild.dirty}.` : ""}`,
        ]
      : []),
    ...(report.environment.voidBuild?.reactSha256
      ? [
          `- Built @void/react JavaScript SHA-256: \`${report.environment.voidBuild.reactSha256}\`; package directory: \`${report.environment.voidBuild.reactDirectory}\`.`,
        ]
      : []),
    "",
    "```text",
    report.environment.vitePlus.trim(),
    "```",
    "",
    "## Versions and output",
    "",
    "| Stack | Resolved packages | Normal output | Command |",
    "| --- | --- | --- | --- |",
  );
  for (const app of selectedApps) {
    const versions = Object.entries(report.environment.packages[app.id] ?? {})
      .filter(([name]) => name !== "toolchain")
      .map(([name, version]) => `${name}@${version}`)
      .join(", ");
    const sample = report.samples.find((item) => item.app === app.id && item.phase === "build");
    lines.push(
      `| ${app.label} | ${versions} | ${app.output} | \`${sample?.command ?? "pending"}\` |`,
    );
  }
  const failed = report.samples.filter((sample) => sample.status !== "success");
  lines.push("", "## Failures", "");
  if (!failed.length) {
    lines.push("None recorded.");
  }
  for (const sample of failed) {
    lines.push(
      `- ${sample.app}, ${sample.phase}, ${sample.cache}, repetition ${sample.repetition}: **${sample.status}**. Log: \`${sample.log}\`.`,
      "",
      "```text",
      stripVTControlCharacters(sample.error ?? "Unknown failure"),
      "```",
      "",
    );
  }
  lines.push(
    "",
    "Raw samples and environment: [results/latest.json](./results/latest.json). Reproduction: [README](./README.md).",
    "",
  );
  return lines.join("\n");
}
