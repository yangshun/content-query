import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  measureIdle,
  random,
  repetitionOrders,
  shuffle,
  spotlightIndexes,
  waitForQuietHost,
} from "../scripts/host.ts";

describe("random", () => {
  test("produces the same sequence for a seed and values within [0, 1)", () => {
    const first = random(42);
    const second = random(42);
    const values = Array.from({ length: 100 }, () => first());
    expect(Array.from({ length: 100 }, () => second())).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(random(43)()).not.toBe(values[0]);
  });
});

describe("shuffle", () => {
  test("returns a permutation without mutating its input", () => {
    const items = ["astro", "vite-react", "nuxt", "void", "next", "tanstack-start"];
    const shuffled = shuffle(items, random(7));
    expect(shuffled.toSorted()).toEqual(items.toSorted());
    expect(items).toEqual(["astro", "vite-react", "nuxt", "void", "next", "tanstack-start"]);
  });
});

describe("repetitionOrders", () => {
  const items = ["astro", "vite-react", "nuxt", "void", "next", "tanstack-start"];

  test("derives one reproducible permutation per repetition", () => {
    const orders = repetitionOrders(items, 3, 2026);
    expect(orders).toHaveLength(3);
    for (const order of orders) {
      expect(order.toSorted()).toEqual(items.toSorted());
    }
    expect(repetitionOrders(items, 3, 2026)).toEqual(orders);
  });

  test("varies the order between repetitions and seeds instead of rotating it", () => {
    const orders = repetitionOrders(items, 20, 1);
    const predecessorsOfVoid = new Set(
      orders.map((order) => order[order.indexOf("void") - 1] ?? "(first)"),
    );
    expect(predecessorsOfVoid.size).toBeGreaterThan(2);
    expect(repetitionOrders(items, 3, 2)).not.toEqual(repetitionOrders(items, 3, 1));
  });
});

describe("measureIdle", () => {
  test("returns the idle fraction of a short real window", async () => {
    const idle = await measureIdle(50);
    expect(idle).toBeGreaterThanOrEqual(0);
    expect(idle).toBeLessThanOrEqual(1);
  });
});

describe("waitForQuietHost", () => {
  const options = { threshold: 0.8, windows: 3, windowMs: 1, timeoutMs: 1_000 };

  test("settles once the rolling mean of recent windows reaches the threshold", async () => {
    const readings = [0.2, 0.95, 0.9, 0.85, 0.99];
    let calls = 0;
    const host = await waitForQuietHost(options, async () => readings[calls++]!);
    expect(calls).toBe(4);
    expect(host.settled).toBe(true);
    expect(host.idle).toBeCloseTo(0.9);
    expect(host.loadAverage).toHaveLength(3);
  });

  test("does not settle on fewer windows than required", async () => {
    let calls = 0;
    const host = await waitForQuietHost(options, async () => {
      calls++;
      return 1;
    });
    expect(calls).toBe(3);
    expect(host.settled).toBe(true);
  });

  test("settles using real CPU measurements by default", async () => {
    const host = await waitForQuietHost({
      threshold: 0,
      windows: 2,
      windowMs: 20,
      timeoutMs: 1_000,
    });
    expect(host.settled).toBe(true);
    expect(host.waitedMs).toBeGreaterThanOrEqual(30);
  });

  test("gives up at the timeout and reports the busy state", async () => {
    const host = await waitForQuietHost({ ...options, timeoutMs: 20 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 0.4;
    });
    expect(host.settled).toBe(false);
    expect(host.idle).toBeCloseTo(0.4);
    expect(host.waitedMs).toBeGreaterThanOrEqual(20);
  });
});

describe("spotlightIndexes", () => {
  test("is unknown outside macOS without writing a probe", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-spotlight-"));
    try {
      expect(await spotlightIndexes(root, { platform: "linux" })).toBeNull();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["indexed", true],
    ["not indexed", false],
    ["search unavailable", null],
  ] as const)("reports %s and removes its probe", async (variant, expected) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-spotlight-"));
    let searches = 0;
    try {
      const result = await spotlightIndexes(root, {
        platform: "darwin",
        timeoutMs: 50,
        intervalMs: 5,
        search: async (directory, token) => {
          searches++;
          if (variant === "search unavailable") {
            throw new Error("mdfind failed");
          }
          expect(token).toMatch(/^contentqueryspotlightprobe/);
          return variant === "indexed" && searches === 2 ? path.join(directory, "probe.txt") : "";
        },
      });
      expect(result).toBe(expected);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
