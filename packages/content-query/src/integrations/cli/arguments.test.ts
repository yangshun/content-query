import { describe, expect, test, vi } from "vite-plus/test";
import { parseArguments } from "./arguments.ts";
import { report } from "./report.ts";
import { ContentError } from "../../shared/errors.ts";

describe("standalone command interface", () => {
  test("maps documented flags without adding a deployment target", () => {
    expect(parseArguments(["build"])).toEqual({});
    expect(
      parseArguments([
        "build",
        "--watch",
        "--config",
        "src/content-query.config.ts",
        "--backend",
        "in-memory",
        "--out-dir",
        "prepared",
      ]),
    ).toEqual({
      watch: true,
      config: "src/content-query.config.ts",
      backend: "in-memory",
      outDir: "prepared",
    });
    expect(parseArguments(["build", "--backend", "generated"])).toEqual({ backend: "generated" });
  });
  test.each([
    [],
    ["unknown"],
    ["build", "--watch", "--watch"],
    ["build", "--config"],
    ["build", "--config", "--watch"],
    ["build", "--target", "ssr"],
    ["build", "--backend", "sqlite"],
  ])("rejects invalid arguments %j", (...arguments_: string[]) => {
    expect(() => parseArguments(arguments_)).toThrow();
  });
  test("shows the build command when the old command is used", () => {
    expect(() => parseArguments(["prepare"])).toThrow("Usage: content-query build");
  });
  test("reports each diagnostic and preserves useful context", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      report(
        new ContentError({
          code: "validation-error",
          message: "Invalid",
          diagnostics: [
            {
              code: "validation-error",
              collection: "posts",
              id: "one",
              source: "post.md",
              message: "Title required",
            },
            { code: "source-error", message: "Offline" },
          ],
        }),
      );
      expect(output.mock.calls[0]![0]).toContain("posts one post.md: Title required");
      expect(output.mock.calls[1]![0]).toContain("source-error");
      report(new Error("Other failure"));
      report("Plain failure");
      expect(output).toHaveBeenCalledWith("Other failure");
      expect(output).toHaveBeenCalledWith("Plain failure");
    } finally {
      output.mockRestore();
    }
  });
});
