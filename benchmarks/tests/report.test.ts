import { describe, expect, test } from "vite-plus/test";
import { renderReport, statistics, type Report } from "../scripts/report.ts";

describe("timing summaries", () => {
  test("computes median and range without mutating measurements", () => {
    const values = [3_000, 1_000, 2_000];
    expect(statistics(values)).toEqual({ median: 2_000, min: 1_000, max: 3_000, count: 3 });
    expect(values).toEqual([3_000, 1_000, 2_000]);
    expect(statistics([1_000, 3_000])).toEqual({ median: 2_000, min: 1_000, max: 3_000, count: 2 });
    expect(statistics([])).toBeNull();
  });

  test("excludes failed samples, shows incomplete denominators, and retains failure reasons", () => {
    const report: Report = {
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
