import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, test, vi } from "vite-plus/test";
import { environment, startProcess, TimeoutError, withTimeout } from "../scripts/process.ts";

describe("process deadlines and cleanup", () => {
  test("does not leak test-runner flags into real framework processes", () => {
    expect(environment.VITEST).toBeUndefined();
    expect(environment.NODE_ENV).toBeUndefined();
    expect(environment.CI).toBe("1");
  });
  test("preserves completed values and rejects operations that exceed the deadline", async () => {
    expect(await withTimeout(Promise.resolve("complete"), 100, "fixture")).toBe("complete");
    await expect(withTimeout(new Promise(() => {}), 10, "fixture")).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  test("tolerates a released process group's permission race after the command exits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-exited-process-"));
    const command = await startProcess(
      process.execPath,
      ["-e", ""],
      root,
      path.join(root, "process.log"),
    );
    await command.closed;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("Process group released"), { code: "EPERM" });
    });
    try {
      await expect(command.stop()).resolves.toBeUndefined();
    } finally {
      kill.mockRestore();
      await command.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "kills a timed-out command and its grandchild",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-process-"));
      const pidFile = path.join(root, "grandchild.pid");
      const script = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); writeFileSync(process.argv[1], String(child.pid)); setInterval(() => {}, 1000);`;
      const command = await startProcess(
        process.execPath,
        ["-e", script, pidFile],
        root,
        path.join(root, "process.log"),
      );
      try {
        let grandchild = 0;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            grandchild = Number(await readFile(pidFile, "utf8"));
            break;
          } catch {
            await sleep(10);
          }
        }
        expect(grandchild).toBeGreaterThan(0);
        await expect(withTimeout(command.closed, 20, "fixture")).rejects.toBeInstanceOf(
          TimeoutError,
        );
        await command.stop();
        for (const pid of [command.pid!, grandchild]) {
          await expect
            .poll(() => {
              try {
                process.kill(pid, 0);
                return true;
              } catch {
                return false;
              }
            })
            .toBe(false);
        }
      } finally {
        await command.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
