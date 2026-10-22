import { describe, expect, test } from "vite-plus/test";
import { summarizeLoad } from "../app/load-metrics";

type Resource = Parameters<typeof summarizeLoad>[0][number];

/** Creates an observed response with independently specified decoded and network byte counts. */
function resource(path: string, overrides: Partial<Resource> = {}): Resource {
  return {
    name: new URL(path, "https://example.com").href,
    entryType: "resource",
    startTime: 0,
    initiatorType: "link",
    decodedBodySize: 0,
    transferSize: 0,
    ...overrides,
  };
}

describe("summarizeLoad", () => {
  test("separates decoded JavaScript, the selected document, and all transferred resources", () => {
    expect(
      summarizeLoad(
        [
          resource("/docs/counter", {
            entryType: "navigation",
            decodedBodySize: 20_000,
            transferSize: 8300,
          }),
          resource("/app.js", { decodedBodySize: 9000, transferSize: 3300 }),
          resource("/document.js", { decodedBodySize: 2000, transferSize: 1000 }),
          resource("/widget.js", { decodedBodySize: 1500 }),
          resource("/styles.css", { decodedBodySize: 500, transferSize: 600 }),
          resource("/image.svg", { decodedBodySize: 400, transferSize: 700 }),
        ],
        "https://example.com/document.js",
      ),
    ).toEqual({ javascript: 12_500, document: 2000, transferred: 13_900, requests: 6, cached: 1 });
  });

  test("does not invent a document size when its module was not requested", () => {
    expect(
      summarizeLoad(
        [resource("/app.js", { decodedBodySize: 9000, transferSize: 3300 })],
        "https://example.com/document.js",
      ).document,
    ).toBe(0);
  });

  test("counts cached code without claiming it was transferred again", () => {
    expect(
      summarizeLoad(
        [resource("/document.js", { decodedBodySize: 2048 })],
        "https://example.com/document.js",
      ),
    ).toEqual({ javascript: 2048, document: 2048, transferred: 0, requests: 1, cached: 1 });
  });

  test("recognizes development scripts and module preloads without counting a .js page as code", () => {
    expect(
      summarizeLoad(
        [
          resource("/@vite/client", { initiatorType: "script", decodedBodySize: 100 }),
          resource("/app/root.tsx?rev=1", { decodedBodySize: 200 }),
          resource("/chunk.mjs?rev=1", { decodedBodySize: 300 }),
          resource("/@id/document", { decodedBodySize: 400 }),
          resource("/docs/example.js", { entryType: "navigation", decodedBodySize: 10_000 }),
        ],
        "https://example.com/@id/document",
      ).javascript,
    ).toBe(1000);
  });

  test("does not combine different revisions of a document module", () => {
    expect(
      summarizeLoad(
        [resource("/document.js?rev=1", { decodedBodySize: 1000 })],
        "https://example.com/document.js?rev=2",
      ).document,
    ).toBe(0);
  });

  test("reports zero activity when the browser reuses already imported modules", () => {
    expect(summarizeLoad([], "https://example.com/document.js")).toEqual({
      javascript: 0,
      document: 0,
      transferred: 0,
      requests: 0,
      cached: 0,
    });
  });
});
