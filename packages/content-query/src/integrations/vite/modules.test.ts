import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ContentError } from "../../shared/errors.ts";
import { projectFixture } from "../../../tests/helpers/project.ts";

import { describe, expect, test, vi } from "vite-plus/test";
import { runInNewContext } from "node:vm";
import { devClient, preparedModules } from "./modules.ts";

/** Executes the emitted client with the same hot-context surface supplied by Vite. */
function clientFixture(development = true, connected = true, document?: object) {
  const handlers = new Map<string, () => void | Promise<void>>();
  const send = vi.fn();
  let dispose = () => {};
  const hot = connected
    ? {
        on: (event: string, callback: () => void | Promise<void>) => handlers.set(event, callback),
        send,
        dispose: (callback: () => void) => {
          dispose = callback;
        },
      }
    : undefined;
  const source = devClient(development)
    .replaceAll("import.meta.hot", "hot")
    .replace("export function", "function");
  const subscribe = runInNewContext(`${source};onContentUpdate;`, { hot, console, document }) as (
    callback: () => void | Promise<void>,
  ) => () => void;
  return { handlers, send, subscribe, dispose: () => dispose() };
}

describe("content update client", () => {
  test("subscribes, reconnects, and unsubscribes only after the last listener", async () => {
    const client = clientFixture();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = client.subscribe(first);
    const stopSecond = client.subscribe(second);
    await client.handlers.get("content-query:update")!();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    await client.handlers.get("vite:ws:connect")!();
    expect(client.send).toHaveBeenLastCalledWith("content-query:subscribe");
    stopFirst();
    expect(client.send).not.toHaveBeenCalledWith("content-query:unsubscribe");
    stopSecond();
    expect(client.send).toHaveBeenLastCalledWith("content-query:unsubscribe");
    client.send.mockClear();
    await client.handlers.get("vite:ws:connect")!();
    expect(client.send).not.toHaveBeenCalled();
  });
  test("coalesces edits during an active refresh and serializes revalidation", async () => {
    const client = clientFixture();
    let finish: () => void = () => {};
    const callback = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    client.subscribe(callback);
    const first = client.handlers.get("content-query:update")!();
    await client.handlers.get("content-query:update")!();
    await client.handlers.get("content-query:update")!();
    expect(callback).toHaveBeenCalledOnce();
    finish();
    await first;
    expect(callback).toHaveBeenCalledTimes(2);
  });
  test("reports callback failures and accepts a later correction", async () => {
    const client = clientFixture();
    const failure = new Error("Loader failed");
    const callback = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      client.subscribe(callback);
      await client.handlers.get("content-query:update")!();
      expect(logged).toHaveBeenCalledWith("[content-query] Could not refresh page data", failure);
      await client.handlers.get("content-query:update")!();
      expect(callback).toHaveBeenCalledTimes(2);
      client.dispose();
      expect(client.send).toHaveBeenLastCalledWith("content-query:unsubscribe");
      await client.handlers.get("content-query:update")!();
      expect(callback).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
  });
  test("clears only ContentQuery diagnostics after successful revalidation", async () => {
    const own = {
      shadowRoot: { querySelector: () => ({ textContent: "[plugin:content-query] " }) },
      close: vi.fn(),
    };
    const other = {
      shadowRoot: { querySelector: () => ({ textContent: "[plugin:other] " }) },
      close: vi.fn(),
    };
    const client = clientFixture(true, true, { querySelectorAll: () => [own, other] });
    await client.handlers.get("content-query:update")!();
    expect(own.close).toHaveBeenCalledOnce();
    expect(other.close).not.toHaveBeenCalled();
  });
  test("is harmless without HMR and becomes a production no-op", () => {
    for (const client of [clientFixture(true, false), clientFixture(false)]) {
      const callback = vi.fn();
      client.subscribe(callback)();
      expect(callback).not.toHaveBeenCalled();
      expect(client.handlers.size).toBe(0);
    }
  });
});

const execute = promisify(execFile);

describe("development error modules", () => {
  test("round-trips BigInt validation details, graphs, and Error causes in an isolated runtime", async () => {
    const fixture = await projectFixture();
    const detail: Record<string, unknown> = {
      date: new Date(0),
      values: new Set([10n]),
      lookup: new Map([[10n, "minimum"]]),
    };
    detail.self = detail;
    const cause = new Error("Source failed", { cause: new TypeError("Root cause") });
    (cause.cause as Error).cause = cause;
    const error = new ContentError({
      code: "validation-error",
      operation: "build",
      collection: "posts",
      id: "one",
      source: "posts.json",
      path: ["value"],
      message: "Too small",
      cause,
      issues: [{ message: "Too small", minimum: 10n, path: ["value"], detail }],
    });
    try {
      const modules = await preparedModules({ error, registry: { posts: { relationships: {} } } });
      await writeFile(path.join(fixture.root, "error.mjs"), modules.get("server.js")!);
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
const {error} = await import("./error.mjs");
const issue = error.issues[0];
console.log(JSON.stringify({code:error.code,collection:error.collection,id:error.id,source:error.source,path:error.path,minimum:issue.minimum === 10n,date:issue.detail.date instanceof Date,cycle:issue.detail.self === issue.detail,set:issue.detail.values.has(10n),map:issue.detail.lookup.get(10n),cause:error.cause instanceof Error && error.cause.message,nested:error.cause.cause.name,causeCycle:error.cause.cause.cause === error.cause,shared:error.cause === error.diagnostics[0].cause}));
`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({
        code: "validation-error",
        collection: "posts",
        id: "one",
        source: "posts.json",
        path: ["value"],
        minimum: true,
        date: true,
        cycle: true,
        set: true,
        map: "minimum",
        cause: "Source failed",
        nested: "TypeError",
        causeCycle: true,
        shared: true,
      });
    } finally {
      await fixture.dispose();
    }
  });
});
