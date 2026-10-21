import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  apps,
  appDirectory,
  benchmarkRoot,
  cacheDirectories,
  command,
  executable,
} from "../scripts/config.ts";
import { generateCorpus } from "../scripts/generate.ts";
import { clearCaches, measureSample, verifyArticle, verifyPage } from "../scripts/measure.ts";
import {
  availablePort,
  startProcess,
  stopAllProcesses,
  waitForListening,
} from "../scripts/process.ts";

describe.sequential("native benchmark apps with isolated content", () => {
  let root: string;
  let browser: Browser;
  const count = 24;

  beforeAll(async () => {
    // Keep Turbopack's symlinked workspace dependencies inside its inferred monorepo root.
    const temporary = path.join(benchmarkRoot, ".runs");
    await mkdir(temporary, { recursive: true });
    root = await realpath(await mkdtemp(path.join(temporary, "smoke-apps-")));
    // Let Vite+ resolve each copied app's binaries instead of the outer workspace's root.
    await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await cp(path.join(benchmarkRoot, "shared"), path.join(root, "shared"), { recursive: true });
    for (const app of apps) {
      const original = appDirectory(benchmarkRoot, app);
      const destination = appDirectory(root, app);
      await cp(original, destination, {
        recursive: true,
        filter: (source) => {
          const relative = path.relative(original, source).split(path.sep);
          return !relative.some((part) =>
            [
              "content",
              "node_modules",
              "void.lock.json",
              ".void-wrangler.jsonc",
              ...cacheDirectories,
            ].includes(part),
          );
        },
      });
      // Share installed packages, while keeping framework caches inside this isolated fixture.
      const dependencies = path.join(destination, "node_modules");
      await mkdir(dependencies);
      for (const dependency of await readdir(path.join(original, "node_modules"))) {
        if ([".cache", ".vite", ".vite-temp", ".astro"].includes(dependency)) {
          continue;
        }
        await symlink(
          await realpath(path.join(original, "node_modules", dependency)),
          path.join(dependencies, dependency),
        );
      }
    }
    await generateCorpus(root, count);
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await stopAllProcesses();
    await browser?.close();
    if (root) {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test.each(apps)(
    "$id loads real content in development and production",
    async (app) => {
      for (const phase of ["startup", "build"] as const) {
        await clearCaches(appDirectory(root, app));
        const sample = await measureSample(
          browser,
          app,
          root,
          count,
          phase,
          "cold",
          1,
          path.join(root, `${app.id}-${phase}.log`),
        );
        expect(sample.status, `${app.id} ${phase}: ${sample.error ?? ""}`).toBe("success");
        expect(sample.durationMs).toBeGreaterThan(0);
        if (phase === "build") {
          expect(sample.prerenderedPages).toBe(count + 1);
          if (app.id === "tanstack-start") {
            const port = await availablePort();
            const preview = await startProcess(
              executable(root, app),
              command(app, "preview", port),
              appDirectory(root, app),
              path.join(root, `${app.id}-navigation.log`),
            );
            const context = await browser.newContext();
            try {
              await waitForListening(port, preview, performance.now() + 30_000);
              const page = await context.newPage();
              const origin = `http://127.0.0.1:${port}`;
              await page.goto(`${origin}/`);
              await Promise.all([
                page.waitForURL(`${origin}/entries/entry-00001/`),
                page.getByRole("link", { name: "Benchmark entry 00001", exact: true }).click(),
              ]);
              await verifyArticle(page, 1, 30_000);
              await Promise.all([
                page.waitForURL(`${origin}/`),
                page.getByRole("link", { name: "All entries", exact: true }).click(),
              ]);
              await verifyPage(page, count, 30_000);
            } finally {
              await context.close();
              await preview.stop();
            }
          }
        }
      }
    },
    180_000,
  );
});
