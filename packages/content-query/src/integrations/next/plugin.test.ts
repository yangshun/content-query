import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";
import type { NextConfig } from "next";
import { buildAtRoot } from "../../preparation/build.ts";
import type { ContentSession } from "../../preparation/session.ts";
import { withContentQuery } from "./plugin.ts";
import { publishDevelopment } from "./publication.ts";

vi.mock("../../preparation/build.ts", () => ({ buildAtRoot: vi.fn() }));
vi.mock("./publication.ts", () => ({
  publishDevelopment: vi.fn(),
  pruneDevelopmentEntries: vi.fn(async () => {}),
}));
vi.mock("../../preparation/config-path.ts", () => ({
  resolveConfigPath: vi.fn(async (root: string, config = "content-query.config.ts") =>
    path.resolve(root, config),
  ),
}));

const context = { defaultConfig: {} as NextConfig };
const build = vi.mocked(buildAtRoot);
const publish = vi.mocked(publishDevelopment);
const dispose = vi.fn(async () => {});
const session = { dispose } as unknown as ContentSession;

describe("withContentQuery", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/work/next-app");
    build.mockReset().mockResolvedValue(session);
    publish.mockReset();
    dispose.mockClear();
  });
  afterEach(async () => {
    build.mockResolvedValue(session);
    await withContentQuery()(PHASE_PRODUCTION_BUILD, context);
    vi.restoreAllMocks();
  });

  test("preserves object, promise, and phase-aware configuration without building server phases", async () => {
    const config: NextConfig = { output: "export", trailingSlash: true };
    const configured = vi.fn(async (phase: string, received: typeof context) => {
      expect(phase).toBe("phase-production-server");
      expect(received).toBe(context);
      return config;
    });
    for (const input of [config, Promise.resolve(config), configured]) {
      expect(await withContentQuery(input)("phase-production-server", context)).toBe(config);
    }
    expect(configured).toHaveBeenCalledOnce();
    expect(build).not.toHaveBeenCalled();
  });

  test.each([
    "/next/dist/telemetry/detached-flush.js",
    "C:\\next\\dist\\telemetry\\detached-flush.js",
  ])("only evaluates configuration in Next's telemetry helper %s", async (entrypoint) => {
    const argv = process.argv;
    const listeners = process.listeners("SIGTERM");
    const config: NextConfig = { trailingSlash: true };
    const configured = vi.fn(async () => config);
    try {
      process.argv = [process.execPath, entrypoint];
      for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD]) {
        expect(await withContentQuery(configured)(phase, context)).toBe(config);
        expect(configured).toHaveBeenLastCalledWith(phase, context);
      }
      expect(build).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(dispose).not.toHaveBeenCalled();
      expect(process.listeners("SIGTERM")).toEqual(listeners);
    } finally {
      process.argv = argv;
    }
  });

  test("waits for initial generation and shares one pending watcher across config evaluations", async () => {
    let complete!: (value: ContentSession) => void;
    build.mockReturnValueOnce(new Promise((resolve) => (complete = resolve)));
    const config = { trailingSlash: true };
    const first = withContentQuery(config)(PHASE_DEVELOPMENT_SERVER, context);
    const second = withContentQuery(config)(PHASE_DEVELOPMENT_SERVER, context);
    await vi.waitFor(() => expect(build).toHaveBeenCalledOnce());
    complete(session);
    expect(await first).toBe(config);
    expect(await second).toBe(config);
    expect(build).toHaveBeenCalledWith(
      "/work/next-app",
      {
        config: "/work/next-app/content-query.config.ts",
        outDir: "/work/next-app/.content-query",
        backend: "generated",
        watch: true,
      },
      expect.any(Function),
    );
    expect(dispose).not.toHaveBeenCalled();
  });

  test("replaces content locations after disposing the previous watcher", async () => {
    await withContentQuery()(PHASE_DEVELOPMENT_SERVER, context);
    await withContentQuery({}, { config: "src/collections.ts", outDir: "prepared" })(
      PHASE_DEVELOPMENT_SERVER,
      context,
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(build).toHaveBeenLastCalledWith(
      "/work/next-app",
      {
        config: "/work/next-app/src/collections.ts",
        outDir: "/work/next-app/prepared",
        backend: "generated",
        watch: true,
      },
      expect.any(Function),
    );
  });

  test("requests cleanup until the first valid publication and keeps later revisions across config evaluations", async () => {
    publish
      .mockReturnValueOnce(undefined)
      .mockReturnValue("/work/next-app/.content-query/current.js");
    await withContentQuery()(PHASE_DEVELOPMENT_SERVER, context);
    const changed = build.mock.calls[0]![2]!;
    changed({});
    changed({});
    await withContentQuery()(PHASE_DEVELOPMENT_SERVER, context);
    changed({});
    expect(build).toHaveBeenCalledOnce();
    expect(publish.mock.calls.map((call) => call[3])).toEqual([
      { prune: true },
      { prune: true },
      { prune: false },
    ]);
  });

  test("closes the development session before a one-shot production build", async () => {
    await withContentQuery()(PHASE_DEVELOPMENT_SERVER, context);
    await withContentQuery()(PHASE_PRODUCTION_BUILD, context);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenLastCalledWith("/work/next-app", {
      backend: "generated",
      watch: false,
    });
  });

  test("allows a new attempt after watcher initialization fails", async () => {
    const failure = new Error("Cannot watch");
    build.mockRejectedValueOnce(failure);
    const config = withContentQuery();
    await expect(config(PHASE_DEVELOPMENT_SERVER, context)).rejects.toBe(failure);
    await expect(config(PHASE_DEVELOPMENT_SERVER, context)).resolves.toEqual({});
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("propagates production failures before Next can compile", async () => {
    const failure = new Error("Invalid content");
    build.mockRejectedValueOnce(failure);
    await expect(withContentQuery()(PHASE_PRODUCTION_BUILD, context)).rejects.toBe(failure);
    expect(dispose).not.toHaveBeenCalled();
  });

  test("closes owned watchers on shutdown and removes its signal listeners", async () => {
    const existing = process.listeners("SIGTERM");
    await withContentQuery()(PHASE_DEVELOPMENT_SERVER, context);
    const added = process.listeners("SIGTERM").filter((listener) => !existing.includes(listener));
    expect(added).toHaveLength(1);
    added[0]!("SIGTERM");
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(process.listeners("SIGTERM")).toEqual(existing);
  });
});
