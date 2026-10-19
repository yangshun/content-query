import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { loaderConfig, loaderLogger } from "./context.ts";

describe("content loader context", () => {
  test("resolves portable defaults and explicit settings without inventing Astro framework configuration", () => {
    const config = loaderConfig("/example", { site: "https://example.com", base: "/docs" });
    expect(fileURLToPath(config.root)).toBe(path.resolve("/example") + path.sep);
    expect(config.site).toBe("https://example.com");
    expect(config.base).toBe("/docs");
    expect(() => Reflect.get(config, "markdown")).toThrow(/loaderConfig.markdown/);
    expect(Reflect.get(config, Symbol.toStringTag)).toBeUndefined();
  });
  test("shares logger destinations and level controls across forks", () => {
    const write = vi.fn();
    const flush = vi.fn();
    const close = vi.fn();
    const logger = loaderLogger("parent", { level: "info", destination: { write, flush, close } });
    logger.debug("hidden");
    logger.info("hello");
    logger.warn("careful");
    logger.error("failure");
    logger.fork("child").info("nested");
    logger.flush();
    logger.close();
    expect(write.mock.calls.map(([entry]) => [entry.label, entry.message])).toEqual([
      ["parent", "hello"],
      ["parent", "careful"],
      ["parent", "failure"],
      ["child", "nested"],
    ]);
    expect(flush).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    logger.options.level = "silent";
    logger.error("hidden too");
    expect(write).toHaveBeenCalledTimes(4);
    loaderLogger("empty").flush();
    loaderLogger("empty").close();
  });
});
