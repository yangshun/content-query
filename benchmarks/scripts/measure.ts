import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Browser, Page } from "playwright";
import {
  type App,
  type Cache,
  type Phase,
  appDirectory,
  buildTimeout,
  cacheDirectories,
  command,
  startupTimeout,
} from "./config.ts";
import { entryNumber } from "./generate.ts";
import {
  availablePort,
  runCommand,
  startProcess,
  TimeoutError,
  waitForListening,
  withTimeout,
} from "./process.ts";

export type Sample = {
  app: App["id"];
  phase: Phase;
  cache: Cache;
  repetition: number;
  status: "success" | "error" | "timeout";
  durationMs?: number;
  listenMs?: number;
  command: string;
  log: string;
  error?: string;
  prerenderedPages?: number;
};

/** Clears only known generated paths; dependencies, source files, and OS caches remain. */
export async function clearCaches(directory: string): Promise<void> {
  for (const cache of cacheDirectories) {
    await rm(path.join(directory, cache), { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Checks values derived from real collections and native Markdown rendering in every stack. */
export async function verifyPage(page: Page, count: number, timeout: number): Promise<void> {
  await page.waitForFunction(
    ({ count, last }) => {
      const items = [...document.querySelectorAll("[data-benchmark-index] li")];
      return (
        document.querySelector("main")?.getAttribute("data-benchmark-count") === String(count) &&
        items.length === count &&
        items.every((item, index) => {
          const number = String(index + 1).padStart(5, "0");
          const link = item.querySelector("a");
          return (
            link?.textContent?.trim() === `Benchmark entry ${number}` &&
            link.getAttribute("href")?.replace(/\/$/, "") === `/entries/entry-${number}` &&
            item.querySelector("p")?.textContent?.trim() ===
              `A deterministic content benchmark document ${number}.`
          );
        }) &&
        document.querySelector("[data-benchmark-last]")?.textContent?.trim() ===
          `Benchmark entry ${last}`
      );
    },
    { count, last: entryNumber(count) },
    { timeout },
  );
}

/** Verifies that an item route renders its own metadata and native Markdown body. */
export async function verifyArticle(page: Page, order: number, timeout: number): Promise<void> {
  await page.waitForFunction(
    (number) => {
      return (
        document.querySelector("main")?.getAttribute("data-benchmark-entry") ===
          `entry-${number}` &&
        document.querySelector("[data-benchmark-title]")?.textContent?.trim() ===
          `Benchmark entry ${number}` &&
        document.querySelector("[data-benchmark-description]")?.textContent?.trim() ===
          `A deterministic content benchmark document ${number}.` &&
        document.querySelector("article h2")?.textContent?.trim() ===
          `Benchmark article ${number}` &&
        document
          .querySelector("article")
          ?.textContent?.includes(`Dataset marker entry-${number}.`) &&
        document.querySelectorAll("article li").length === 3 &&
        document.querySelector("article strong")?.textContent === "Consistent inputs" &&
        !!document.querySelector('article a[href="https://example.com/benchmark"]')
      );
    },
    entryNumber(order),
    { timeout },
  );
}

/** Audits every emitted item page as HTML, so an SPA shell or runtime SSR cannot pass as SSG. */
export async function verifyStaticOutput(app: App, root: string, count: number): Promise<number> {
  const output = path.join(appDirectory(root, app), app.staticOutput);
  const index = await readFile(path.join(output, "index.html"), "utf8");
  const links = [...index.matchAll(/<a\b[^>]*href=["']\/entries\/entry-(\d+)\/?["']/g)];
  if (links.length !== count || links.some((match, index) => match[1] !== entryNumber(index + 1))) {
    throw new Error(`The prerendered homepage must link all ${count} entries in order.`);
  }
  const emitted = await readdir(path.join(output, "entries"), { recursive: true });
  if (emitted.filter((filename) => filename.endsWith(".html")).length !== count) {
    throw new Error(`Expected exactly ${count} prerendered item HTML files.`);
  }
  const pending = Array.from({ length: count }, (_, index) => index + 1).values();
  await Promise.all(
    Array.from({ length: Math.min(16, count) }, async () => {
      for (const order of pending) {
        const number = entryNumber(order);
        const id = `entry-${number}`;
        const filename = app.htmlLayout === "flat" ? `${id}.html` : `${id}/index.html`;
        const html = await readFile(path.join(output, "entries", filename), "utf8");
        const article = /<article\b[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1];
        if (
          !html.includes(`data-benchmark-entry="${id}"`) ||
          !article?.includes(`Dataset marker entry-${number}.`) ||
          !article.includes(`Benchmark article ${number}`)
        ) {
          throw new Error(`The emitted HTML for ${id} does not contain its rendered article.`);
        }
      }
    }),
  );
  return count + 1;
}

/** Measures a fresh browser context against either development or built application output. */
export async function measureStartup(
  browser: Browser,
  app: App,
  root: string,
  count: number,
  log: string,
  preview = false,
): Promise<{ durationMs: number; listenMs: number }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const port = await availablePort();
  const process_ = await startProcess(
    "vp",
    command(app, preview ? "preview" : "dev", port),
    appDirectory(root, app),
    log,
  );
  const deadline = process_.started + startupTimeout;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const listenMs = await waitForListening(port, process_, deadline);
    while (performance.now() < deadline) {
      process_.assertRunning();
      try {
        const response = await page.goto(`http://127.0.0.1:${port}/`, {
          waitUntil: "load",
          timeout: Math.max(1, deadline - performance.now()),
        });
        if (response?.status() === 503) {
          await sleep(50);
          continue;
        }
        if (response && !response.ok()) {
          throw new Error(`Application returned HTTP ${response?.status()}.\n${process_.output()}`);
        }
        await withTimeout(
          verifyPage(page, count, Math.max(1, deadline - performance.now())),
          Math.max(1, deadline - performance.now()),
          "Content readiness",
        );
        for (const order of new Set([1, count])) {
          const article = await page.goto(
            `http://127.0.0.1:${port}/entries/entry-${entryNumber(order)}/`,
            {
              waitUntil: "load",
              timeout: Math.max(1, deadline - performance.now()),
            },
          );
          if (!article?.ok()) {
            throw new Error(`Item ${order} returned HTTP ${article?.status()}.`);
          }
          await verifyArticle(page, order, Math.max(1, deadline - performance.now()));
        }
        if (errors.length) {
          throw new Error(`Browser errors: ${errors.join("; ")}`);
        }
        return { listenMs, durationMs: performance.now() - process_.started };
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !/ERR_CONNECTION_(REFUSED|RESET)|ERR_EMPTY_RESPONSE|ERR_ABORTED/.test(cause.message)
        ) {
          throw cause;
        }
        await sleep(50);
      }
    }
    throw new TimeoutError("Content was not usable before the startup deadline.");
  } catch (cause) {
    if (cause instanceof Error) {
      cause.message += `\nServer output:\n${process_.output()}`;
    }
    throw cause;
  } finally {
    await context.close();
    await process_.stop();
  }
}

/** Records errors as failed samples, and validates production output outside the build timer. */
export async function measureSample(
  browser: Browser,
  app: App,
  root: string,
  count: number,
  phase: Phase,
  cache: Cache,
  repetition: number,
  log: string,
): Promise<Sample> {
  const sample: Sample = {
    app: app.id,
    phase,
    cache,
    repetition,
    status: "success",
    command: `vp ${command(app, phase === "startup" ? "dev" : "build").join(" ")}`,
    log: path.relative(root, log),
  };
  try {
    if (phase === "startup") {
      Object.assign(sample, await measureStartup(browser, app, root, count, log));
    } else {
      sample.durationMs = await runCommand(
        command(app, "build"),
        appDirectory(root, app),
        log,
        buildTimeout,
      );
      sample.prerenderedPages = await verifyStaticOutput(app, root, count);
      await measureStartup(browser, app, root, count, log.replace(/\.log$/, "-preview.log"), true);
    }
  } catch (cause) {
    sample.status =
      cause instanceof TimeoutError || (cause instanceof Error && cause.name === "TimeoutError")
        ? "timeout"
        : "error";
    sample.error = cause instanceof Error ? cause.message : String(cause);
  }
  return sample;
}
