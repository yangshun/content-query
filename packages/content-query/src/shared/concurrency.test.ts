import { describe, expect, test } from "vite-plus/test";
import { mapConcurrent } from "./concurrency.ts";

describe("mapConcurrent", () => {
  test("keeps input order without exceeding the limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapConcurrent([5, 1, 4, 2, 3], 2, async (value, index) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active--;
      return `${index}:${value}`;
    });
    expect(results).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3"]);
    expect(peak).toBe(2);
  });
  test("handles empty input and limits below one", async () => {
    expect(await mapConcurrent([], 4, async () => 1)).toEqual([]);
    expect(await mapConcurrent([1, 2], 0, async (value) => value * 2)).toEqual([2, 4]);
  });
  test("rejects with the first failure and stops claiming new items", async () => {
    const started: number[] = [];
    await expect(
      mapConcurrent([1, 2, 3, 4], 1, async (value) => {
        started.push(value);
        if (value === 2) {
          throw new Error("second failed");
        }
        return value;
      }),
    ).rejects.toThrow("second failed");
    expect(started).toEqual([1, 2]);
  });
});
