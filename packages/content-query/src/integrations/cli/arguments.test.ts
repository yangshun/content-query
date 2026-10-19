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
  test("accepts short flags and values joined with an equals sign", () => {
    expect(
      parseArguments([
        "build",
        "-w",
        "-c",
        "src/content-query.config.ts",
        "--backend=in-memory",
        "-o",
        "output",
      ]),
    ).toEqual({
      watch: true,
      config: "src/content-query.config.ts",
      backend: "in-memory",
      outDir: "output",
    });
    expect(parseArguments(["build", "--config=collections.ts", "--out-dir=output"])).toEqual({
      config: "collections.ts",
      outDir: "output",
    });
  });
  test("keeps numeric path options as strings and accepts an explicit watch boolean", () => {
    expect(parseArguments(["build", "--config=123", "--out-dir=456", "--watch=false"])).toEqual({
      config: "123",
      outDir: "456",
      watch: false,
    });
  });
  test.each([
    ["--help"],
    ["-h"],
    ["build", "--help"],
    ["--version"],
    ["-v"],
    ["build", "--version"],
  ])("prints information without requesting a build: %j", (...arguments_: string[]) => {
    const output = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(parseArguments(arguments_)).toBeUndefined();
      expect(output).toHaveBeenCalledWith(expect.stringContaining("content-query/"));
    } finally {
      output.mockRestore();
    }
  });
  test.each([
    [],
    ["unknown"],
    ["build", "--watch", "--watch"],
    ["build", "--config"],
    ["build", "--config", "--watch"],
    ["build", "--target", "ssr"],
    ["build", "--backend", "sqlite"],
    ["build", "--config", "one.ts", "--config", "two.ts"],
    ["build", "-c", "one.ts", "--config", "two.ts"],
    ["build", "-wc", "one.ts", "--config", "two.ts"],
    ["build", "-ww"],
    ["build", "--watch", "--no-watch"],
    ["build", "--backend=generated", "--backend=in-memory"],
    ["build", "--out-dir=one", "--out-dir=two"],
    ["build", "extra"],
    ["build", "--", "extra"],
    ["build", "--config.nested=file"],
    ["build", "--watch.nested=true"],
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
