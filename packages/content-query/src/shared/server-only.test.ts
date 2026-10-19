import { describe, expect, test } from "vite-plus/test";
import { assertServerOnly } from "./server-only.ts";

describe("assertServerOnly", () => {
  test("allows server execution and rejects a browser-like global", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    try {
      Reflect.deleteProperty(globalThis, "window");
      expect(() => assertServerOnly()).not.toThrow();
      Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
      expect(() => assertServerOnly()).toThrow("server-only");
    } finally {
      Reflect.deleteProperty(globalThis, "window");
      if (original) {
        Object.defineProperty(globalThis, "window", original);
      }
    }
  });
});
