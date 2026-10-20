import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

export type SettleOptions = {
  /** Minimum fraction of host CPU time spent idle, from 0 to 1. */
  threshold: number;
  /** Number of consecutive measurement windows averaged against the threshold. */
  windows: number;
  windowMs: number;
  /** Maximum wait before measuring anyway; the sample then records that the host was busy. */
  timeoutMs: number;
};

export type HostState = {
  settled: boolean;
  waitedMs: number;
  /** Mean idle fraction over the final measurement windows before the sample started. */
  idle: number;
  loadAverage: number[];
};

export const defaultSettle: SettleOptions = {
  threshold: 0.8,
  windows: 3,
  windowMs: 1_000,
  timeoutMs: 180_000,
};

function cpuTicks(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

/** Measures the fraction of all logical CPUs' time spent idle during one window. */
export async function measureIdle(windowMs: number): Promise<number> {
  const before = cpuTicks();
  await sleep(windowMs);
  const after = cpuTicks();
  const total = after.total - before.total;
  return total > 0 ? (after.idle - before.idle) / total : 1;
}

/**
 * Waits until background work from previous samples, such as file indexing, has subsided.
 * Returns the observed state either way so busy samples remain identifiable.
 */
export async function waitForQuietHost(
  options: SettleOptions,
  measure: (windowMs: number) => Promise<number> = measureIdle,
): Promise<HostState> {
  const started = performance.now();
  const recent: number[] = [];
  let idle = 0;
  for (;;) {
    recent.push(await measure(options.windowMs));
    if (recent.length > options.windows) {
      recent.shift();
    }
    idle = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const waitedMs = performance.now() - started;
    const settled = recent.length === options.windows && idle >= options.threshold;
    if (settled || waitedMs >= options.timeoutMs) {
      return { settled, waitedMs, idle, loadAverage: os.loadavg() };
    }
  }
}

/** Creates a deterministic pseudo-random number generator (mulberry32) for reproducible orders. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Returns a shuffled copy using the supplied generator, leaving the input unchanged. */
export function shuffle<Item>(items: readonly Item[], next: () => number): Item[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  return shuffled;
}

/** Derives one independent, reproducible application order per repetition from a single seed. */
export function repetitionOrders<Item>(
  items: readonly Item[],
  runs: number,
  seed: number,
): Item[][] {
  const next = random(seed);
  return Array.from({ length: runs }, () => shuffle(items, next));
}

/**
 * Reports whether Spotlight indexes newly written files in a directory, or `null` where that
 * cannot be determined. Marker files are not honored for ordinary folders on recent macOS.
 */
export async function spotlightIndexes(
  directory: string,
  options: {
    platform?: NodeJS.Platform;
    timeoutMs?: number;
    intervalMs?: number;
    search?: (directory: string, token: string) => Promise<string>;
  } = {},
): Promise<boolean | null> {
  const {
    platform = process.platform,
    timeoutMs = 20_000,
    intervalMs = 1_000,
    search = async (root, token) =>
      (await execute("mdfind", ["-onlyin", root, token], { timeout: 5_000 })).stdout,
  } = options;
  if (platform !== "darwin") {
    return null;
  }
  const token = `contentqueryspotlightprobe${randomUUID().replaceAll("-", "")}`;
  const probe = path.join(directory, "spotlight-probe");
  await mkdir(probe, { recursive: true });
  try {
    await writeFile(path.join(probe, "probe.txt"), `${token}\n`);
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if ((await search(probe, token)).includes("probe.txt")) {
        return true;
      }
      await sleep(intervalMs);
    }
    return false;
  } catch {
    return null;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}
