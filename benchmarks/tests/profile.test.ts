import { describe, expect, test } from "vite-plus/test";
import { buildStructure, summarizeCpu } from "../scripts/summarize-profile.ts";

describe("CPU profile attribution", () => {
  test("separates idle and active time and attributes inclusive recursive frames once", () => {
    const result = summarizeCpu({
      nodes: [
        { id: 1, callFrame: { functionName: "(root)", url: "" }, children: [2, 3] },
        { id: 2, callFrame: { functionName: "(idle)", url: "" } },
        { id: 3, callFrame: { functionName: "outer", url: "app.js" }, children: [4] },
        { id: 4, callFrame: { functionName: "inner", url: "app.js" }, children: [5] },
        { id: 5, callFrame: { functionName: "outer", url: "app.js" } },
      ],
      samples: [2, 3, 4, 5],
      timeDeltas: [5000, 2000, 3000, 1000],
    });
    expect(result).toMatchObject({ sampledMs: 11, activeMs: 6, idleMs: 5 });
    expect(result.self.find(({ name }) => name === "outer")?.durationMs).toBe(3);
    expect(result.inclusive.find(({ name }) => name === "outer")?.durationMs).toBe(6);
    expect(result.inclusive.find(({ name }) => name === "inner")?.durationMs).toBe(4);
    expect(result.inclusive.find(({ name }) => name === "outer")?.activePercent).toBe(100);
  });

  test("handles empty profiles without inventing activity", () => {
    expect(summarizeCpu({ nodes: [], samples: [], timeDeltas: [] })).toEqual({
      sampledMs: 0,
      activeMs: 0,
      idleMs: 0,
      self: [],
      inclusive: [],
    });
  });
});

describe("native build structure", () => {
  test("counts payload facades separately from grouped data and ignores CSS/client assets", () => {
    expect(
      buildStructure(`\u001b[2K\rtransforming...✓ 10100 modules transformed.
dist/ssr/assets/${"a".repeat(64)}-example.js 0.22 kB
dist/ssr/assets/content-query-payloads-example.js 128 kB
dist/ssr/assets/styles.css 0.20 kB
dist/client/assets/client.js 100 kB
transforming...✓ 26 modules transformed.`),
    ).toEqual({
      serverModulesTransformed: 10100,
      clientModulesTransformed: 26,
      serverAssetJsFiles: 2,
      hashedEntryJsFiles: 1,
      outputPayloadGroupJsFiles: 1,
    });
    expect(buildStructure("Server is listening.")).toBeUndefined();
  });
});
