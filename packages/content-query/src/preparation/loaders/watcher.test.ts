import { FSWatcher } from "chokidar";
import { describe, expect, test, vi } from "vite-plus/test";
import { guardedWatcher } from "./watcher.ts";

describe("loader-owned watcher listeners", () => {
  test("supports listener removal, once callbacks, chaining, and isolated cleanup", async () => {
    const watcher = new FSWatcher({ ignoreInitial: true });
    const first = vi.fn();
    const other = vi.fn();
    const removed = vi.fn();
    const once = vi.fn();
    const failed = vi.fn();
    const left = guardedWatcher(
      watcher,
      async (callback) => {
        await callback();
      },
      failed,
    );
    const right = guardedWatcher(
      watcher,
      async (callback) => {
        await callback();
      },
      failed,
    );
    try {
      expect(left.watcher!.add([])).toBe(left.watcher);
      left.watcher!.on("change", first).on("change", removed);
      right.watcher!.on("change", other);
      left.watcher!.off("change", removed);
      watcher.emit("change", "one");
      await vi.waitFor(() => expect(other).toHaveBeenCalledTimes(1));
      expect(first).toHaveBeenCalledTimes(1);
      expect(removed).not.toHaveBeenCalled();
      left.watcher!.removeAllListeners("change").once("change", once);
      watcher.emit("change", "two");
      watcher.emit("change", "three");
      await vi.waitFor(() => expect(other).toHaveBeenCalledTimes(3));
      expect(once).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledTimes(1);
      left.watcher!.on("unlink", removed).removeListener("unlink", removed);
      left.watcher!.on("add", removed).removeAllListeners();
      watcher.emit("unlink", "unused");
      watcher.emit("add", "unused");
      left.cleanup();
      right.cleanup();
      watcher.emit("change", "after cleanup");
      await Promise.resolve();
      expect(other).toHaveBeenCalledTimes(3);
      expect(failed).not.toHaveBeenCalled();
    } finally {
      await watcher.close();
    }
  });
  test("reports rejected callbacks and keeps later source events usable", async () => {
    const watcher = new FSWatcher({ ignoreInitial: true });
    const failed = vi.fn();
    let broken = true;
    const completed = vi.fn();
    const guarded = guardedWatcher(
      watcher,
      async (callback) => {
        await callback();
      },
      failed,
    );
    guarded.watcher!.on("change", async () => {
      if (broken) {
        throw new Error("offline");
      }
      completed();
    });
    try {
      watcher.emit("change", "one");
      await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
      broken = false;
      watcher.emit("change", "two");
      await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    } finally {
      guarded.cleanup();
      await watcher.close();
    }
  });
});
