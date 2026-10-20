import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

/** Enforces a deadline without leaving its timer active after a successful operation. */
export async function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`${label} exceeded ${milliseconds} ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const environment: NodeJS.ProcessEnv = {
  ...process.env,
  CI: "1",
  NO_COLOR: "1",
  ASTRO_TELEMETRY_DISABLED: "1",
  NUXT_TELEMETRY_DISABLED: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const name of Object.keys(environment)) {
  if (name === "NODE_ENV" || name.startsWith("VITEST")) {
    delete environment[name];
  }
}

const cleanup = new Set<() => Promise<void>>();

/** Stops every child group if the benchmark is interrupted from the terminal. */
export async function stopAllProcesses(): Promise<void> {
  await Promise.all([...cleanup].map((stop) => stop()));
}

/** Captures a command and owns its entire process group, including grandchildren on POSIX. */
export async function startProcess(
  executable: string,
  arguments_: string[],
  cwd: string,
  log: string,
) {
  await mkdir(path.dirname(log), { recursive: true });
  const output = createWriteStream(log);
  let tail = "";
  let running = true;
  const started = performance.now();
  const child = spawn(executable, arguments_, {
    cwd,
    env: environment,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk: Buffer) => {
      output.write(chunk);
      tail = (tail + chunk.toString()).slice(-8_000);
    });
  }
  const closed = new Promise<{ code: number | null; error?: Error; elapsedMs: number }>(
    (resolve) => {
      child.once("error", (error) => {
        running = false;
        resolve({ code: null, error, elapsedMs: performance.now() - started });
      });
      child.once("close", (code) => {
        running = false;
        resolve({ code, elapsedMs: performance.now() - started });
      });
    },
  );

  function signalGroup(signal: NodeJS.Signals) {
    if (child.pid === undefined) {
      return;
    }
    try {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      // An exited process may already have released its group before cleanup runs.
      const exited = !running || child.exitCode !== null || child.signalCode !== null;
      if (code !== "ESRCH" && !(code === "EPERM" && exited)) {
        throw cause;
      }
    }
  }

  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= (async () => {
      signalGroup("SIGTERM");
      await Promise.race([closed, sleep(1_000)]);
      signalGroup("SIGKILL");
      await closed;
      await new Promise<void>((resolve) => output.end(resolve));
      cleanup.delete(stop);
    })();
    return stopping;
  }
  cleanup.add(stop);

  return {
    pid: child.pid,
    started,
    closed,
    output: () => tail,
    assertRunning() {
      if (!running) {
        throw new Error(
          `Command exited before content was ready: ${executable} ${arguments_.join(" ")}\n${tail}`,
        );
      }
    },
    stop,
  };
}

export type ManagedProcess = Awaited<ReturnType<typeof startProcess>>;

/** Reserves a currently unused loopback port before spawning an application. */
export async function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a TCP port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

/** Probes TCP only, leaving the first HTTP request and module compilation to the browser. */
export async function waitForListening(
  port: number,
  process_: ManagedProcess,
  deadline: number,
): Promise<number> {
  while (performance.now() < deadline) {
    process_.assertRunning();
    const listening = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(100);
      const finish = (connected: boolean) => {
        socket.destroy();
        resolve(connected);
      };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
    });
    if (listening) {
      return performance.now() - process_.started;
    }
    await sleep(10);
  }
  throw new TimeoutError("Server did not listen before the startup deadline.");
}

/** Runs a build to completion, killing its process tree on failure or timeout. */
export async function runCommand(
  executable: string,
  arguments_: string[],
  cwd: string,
  log: string,
  timeout: number,
): Promise<number> {
  const process_ = await startProcess(executable, arguments_, cwd, log);
  try {
    const result = await withTimeout(process_.closed, timeout, "Command");
    if (result.error || result.code !== 0) {
      throw (
        result.error ??
        new Error(
          `Command failed (${result.code}): ${executable} ${arguments_.join(" ")}\n${process_.output()}`,
        )
      );
    }
    return result.elapsedMs;
  } finally {
    await process_.stop();
  }
}
