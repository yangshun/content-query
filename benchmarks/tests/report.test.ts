import { describe, expect, test } from "vite-plus/test";
import { renderReport, statistics, type Report } from "../scripts/report.ts";

/** Builds a report with one successful and one timed-out build sample. */
function fixture(): Report {
  return {
    workload: "full-index-and-prerendered-articles",
    startedAt: "2026-10-19T00:00:00.000Z",
    repetitions: 3,
    corpus: {
      entries: 10_000,
      bytes: 10_000_000,
      sha256: "corpus-hash",
      hardlinks: 40_000,
      copies: 0,
    },
    environment: {
      node: "v24.21.0",
      platform: "darwin",
      architecture: "arm64",
      osRelease: "test",
      cpu: "test CPU",
      logicalCpus: 8,
      memoryBytes: 16 * 1024 ** 3,
      vitePlus: "vp version",
      chromium: "test",
      revision: "revision",
      dirty: true,
      lockfileSha256: "lock-hash",
      contentQueryArtifactsSha256: "artifact-hash",
      packages: {},
    },
    samples: [
      {
        app: "astro",
        phase: "build",
        cache: "cold",
        repetition: 1,
        status: "success",
        durationMs: 2_000,
        prerenderedPages: 10_001,
        command: "vp exec astro build",
        log: "build.log",
      },
      {
        app: "astro",
        phase: "build",
        cache: "cold",
        repetition: 2,
        status: "timeout",
        durationMs: 0,
        command: "vp exec astro build",
        log: "timeout.log",
        error: "\u001b[31mDeadline exceeded\u001b[0m",
      },
    ],
  };
}

describe("timing summaries", () => {
  test("omits unrequested stacks while retaining pending samples for requested stacks", () => {
    const report = fixture();
    report.control = {
      seed: 2026,
      orders: [["astro", "void"]],
      settle: { threshold: 0.8, windows: 3, windowMs: 1_000, timeoutMs: 180_000 },
      spotlightIndexesApps: false,
    };
    const markdown = renderReport(report);
    const coldTable = markdown.split("### Cold\n")[1]!.split("### Warm\n")[0]!;
    expect(coldTable.split("\n").filter((line) => line.startsWith("| "))).toHaveLength(4);
    expect(coldTable).toContain("Void + ContentQuery | Failed / pending");
    expect(coldTable).toContain("Astro collections");
    expect(markdown).toContain("2 requested stacks in this run");
    expect(markdown).not.toContain("| TanStack Start + ContentQuery |");
    expect(markdown).not.toContain("| Nuxt Content |");
    expect(markdown).not.toContain("| Next.js + ContentQuery |");
    expect(markdown).not.toContain("| Vite + React + Content Collections |");
  });

  test("computes median and range without mutating measurements", () => {
    const values = [3_000, 1_000, 2_000];
    expect(statistics(values)).toEqual({ median: 2_000, min: 1_000, max: 3_000, count: 3 });
    expect(values).toEqual([3_000, 1_000, 2_000]);
    expect(statistics([1_000, 3_000])).toEqual({ median: 2_000, min: 1_000, max: 3_000, count: 2 });
    expect(statistics([])).toBeNull();
  });

  test("excludes failed samples, shows incomplete denominators, and retains failure reasons", () => {
    const report = fixture();
    const markdown = renderReport(report);
    expect(markdown).toContain("2.00 (2.00–2.00; n=1/3)");
    expect(markdown).toContain("Failed / pending");
    expect(markdown).toContain("Deadline exceeded");
    expect(markdown).not.toContain("\u001b");
    expect(markdown).toContain("1/2 recorded samples passed");
    expect(markdown).toContain(
      "1/2 recorded production builds emitted and verified every content HTML page",
    );
    expect(markdown).toContain("OS filesystem caches remain");
    expect(markdown).toContain("corpus-hash");
    expect(markdown).toContain("10,001 content HTML pages");
    expect(markdown).toContain("first and last dedicated articles");
    const coldTable = markdown.split("### Cold\n")[1]!.split("### Warm\n")[0]!;
    const warmTable = markdown.split("### Warm\n")[1]!.split("## Method\n")[0]!;
    for (const table of [coldTable, warmTable]) {
      const rows = table.split("\n").filter((line) => line.startsWith("| "));
      expect(rows.map((row) => row.split(" | ")[0])).toEqual([
        "| Stack",
        "| ---",
        "| Void + ContentQuery",
        "| Astro collections",
        "| TanStack Start + ContentQuery",
        "| Vite + React + Content Collections",
        "| Nuxt Content",
        "| Next.js + ContentQuery",
      ]);
      expect(table).not.toContain("| Cache |");
      expect(table).toContain("| Stack | Content usable | Production build |");
      expect(table).not.toContain("Server listening");
    }
    expect(markdown).toContain("Only one framework and measurement type");
    report.samples[0]!.durationMs = 1_234.567;
    expect(renderReport(report)).toContain("1.23 (1.23–1.23; n=1/3)");
    expect(report.samples[0]!.durationMs).toBe(1_234.567);
    report.error = "The built ContentQuery package changed during measurement.";
    expect(renderReport(report)).toContain("Run aborted; these timings are invalid");
  });
});

describe("measurement controls", () => {
  test("identifies locally built Void even when its release version is unchanged", () => {
    const report = fixture();
    report.environment.voidBuild = {
      directory: "../../../void/packages/void",
      sha256: "void-build-hash",
      reactSha256: "react-build-hash",
      reactDirectory: "../../../void/packages/react",
      revision: "void-source-revision",
      dirty: true,
    };
    const markdown = renderReport(report);
    expect(markdown).toContain("Built Void JavaScript SHA-256: `void-build-hash`");
    expect(markdown).toContain("Built @void/react JavaScript SHA-256: `react-build-hash`");
    expect(markdown).toContain("package directory: `../../../void/packages/void`");
    expect(markdown).toContain(
      "Source revision: `void-source-revision`; uncommitted package changes: true",
    );
  });

  test("reports randomized orders, the settle gate, Spotlight state, and busy samples", () => {
    const report = fixture();
    report.control = {
      seed: 2026,
      orders: [
        ["next", "void", "astro"],
        ["astro", "next", "void"],
      ],
      settle: { threshold: 0.8, windows: 3, windowMs: 1_000, timeoutMs: 180_000 },
      spotlightIndexesApps: true,
    };
    report.samples[0]!.host = { settled: true, waitedMs: 4_000, idle: 0.9, loadAverage: [1, 2, 3] };
    report.samples[1]!.host = {
      settled: false,
      waitedMs: 180_000,
      idle: 0.5,
      loadAverage: [9.5, 8, 7],
    };
    const markdown = renderReport(report);
    expect(markdown).toContain("seed `2026`");
    expect(markdown).toContain("1. next, void, astro\n2. astro, next, void");
    expect(markdown).toContain(
      "at least 80% idle, averaged over 3 consecutive 1-second windows, for up to 180 seconds. 1/2 samples started on a settled host.",
    );
    expect(markdown).toContain("Median idle before a sample: 70% (50%–90%)");
    expect(markdown).toContain("median wait: 92.0 s (maximum 180.0 s)");
    expect(markdown).toContain("Spotlight indexed new files");
    expect(markdown).toContain(
      "- astro, build, cold, repetition 2: 50% idle; load average 9.50, 8.00, 7.00.",
    );
    expect(markdown).toContain("seeded random app order per repetition");
    expect(markdown).not.toContain("rotating app order");
    report.control.spotlightIndexesApps = false;
    expect(renderReport(report)).toContain("Spotlight did not index new files");
    report.control.spotlightIndexesApps = null;
    expect(renderReport(report)).toContain("could not be determined");
  });

  test("identifies reports recorded before measurement controls existed", () => {
    expect(renderReport(fixture())).toContain("Measurement controls were not recorded");
  });
});
