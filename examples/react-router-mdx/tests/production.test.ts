import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import type { MdxAssetManifest } from "@content-query/mdx";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

/** Copies application inputs while sharing installed dependencies with an isolated consumer. */
async function copyExample(root: string): Promise<void> {
  for (const source of [
    "app",
    "content",
    "react-router.config.ts",
    "package.json",
    "content-query.config.ts",
    "vite.config.ts",
    "tsconfig.json",
  ]) {
    await cp(path.join(appRoot, source), path.join(root, source), { recursive: true });
  }
  const dependencies = path.join(root, "node_modules");
  await mkdir(dependencies);
  for (const name of await readdir(path.join(appRoot, "node_modules"))) {
    const source = path.join(appRoot, "node_modules", name);
    const destination = path.join(dependencies, name);
    if (name !== ".bin") {
      await symlink(source, destination, "dir");
      continue;
    }
    await mkdir(destination);
    for (const binary of await readdir(source)) {
      // pnpm launchers resolve relative paths from their physical installed location.
      const executable = await realpath(path.join(source, binary));
      await writeFile(
        path.join(destination, binary),
        `#!/usr/bin/env node\nimport {spawnSync} from "node:child_process";\nconst result=spawnSync(${JSON.stringify(executable)},process.argv.slice(2),{stdio:"inherit"});\nif(result.error){throw result.error;}\nprocess.exit(result.status??1);\n`,
        { mode: 0o755 },
      );
    }
  }
}

/** Reserves an available loopback port before starting a framework-owned server. */
async function availablePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address() as { port: number };
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

/** Stops a command and its framework CLI children, including development relaunches. */
async function stopServer(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ESRCH") {
      throw cause;
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

describe("MDX + React islands production example", () => {
  let root: string;
  let child: ChildProcess;
  let origin: string;
  let browser: Browser;
  let manifest: MdxAssetManifest;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "cq-mdx-production-")));
    await copyExample(root);
    await promisify(execFile)("vp", ["run", "build"], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      maxBuffer: 2_000_000,
      timeout: 60_000,
    });
    manifest = JSON.parse(
      await readFile(path.join(root, "build/client/.vite/content-query-mdx-manifest.json"), "utf8"),
    ) as MdxAssetManifest;
    await rm(path.join(root, "content"), { recursive: true });
    await rm(path.join(root, "content-query.config.ts"));
    await rm(path.join(root, "app"), { recursive: true });
    await rm(path.join(root, ".content-query"), { recursive: true });
    const port = await availablePort();
    origin = `http://127.0.0.1:${port}`;
    child = spawn("vp", ["exec", "react-router-serve", "./build/server/index.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    child.stdout!.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr!.on("data", (data: Buffer) => {
      output += data.toString();
    });
    await vi.waitFor(
      async () => {
        const response = await fetch(origin);
        expect(response.status, output).toBe(200);
      },
      { timeout: 15_000 },
    );
    browser = await chromium.launch();
  }, 80_000);

  afterAll(async () => {
    await browser?.close();
    await stopServer(child);
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  /** Captures errors and downloaded JavaScript for actual browser assertions. */
  async function page() {
    const page_ = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = [];
    const scripts: string[] = [];
    page_.on("pageerror", (error) => errors.push(error.message));
    page_.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page_.on("request", (request) => {
      if (request.resourceType() === "script") {
        scripts.push(request.url());
      }
    });
    return { page: page_, errors, scripts };
  }

  test("serves SSR content, CSS, selected references, and 404s without source files", async () => {
    const response = await fetch(`${origin}/islands/docs/counter`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('data-cq-strategy="load"');
    expect(html).toContain('rel="stylesheet"');
    const deferred = await (await fetch(`${origin}/islands/docs/loading`)).text();
    expect(deferred).toContain('data-cq-strategy="visible"');
    expect((await fetch(`${origin}/islands/docs/missing`)).status).toBe(404);
    expect((await fetch(`${origin}/unknown`)).status).toBe(404);
    expect(Object.keys(manifest.documents)).toHaveLength(3);
    expect(Object.keys(manifest.islands)).toHaveLength(2);
    for (const asset of manifest.assets) {
      expect((await fetch(`${origin}${asset}`)).ok).toBe(true);
    }
    const react = await (await fetch(`${origin}/react/docs/counter`)).text();
    expect(react).toContain("mdx-document-");
    expect(react).not.toContain('"documents":');
    expect(react).not.toContain("data-cq-island");
  });

  test("hydrates one selected widget, loads its styles, and excludes unrelated JavaScript", async () => {
    const { page: page_, errors, scripts } = await page();
    try {
      await page_.goto(`${origin}/islands/docs/counter`, { waitUntil: "networkidle" });
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      await vi.waitFor(async () =>
        expect(await page_.getByRole("status", { name: "Count" }).textContent()).toBe("1"),
      );
      expect(
        await page_
          .getByRole("complementary")
          .filter({ hasText: "The article stays static" })
          .evaluate((element) => getComputedStyle(element).borderLeftWidth),
      ).toBe("3px");
      expect(await page_.locator("[data-cq-island]").count()).toBe(1);
      expect(scripts.filter((url) => url.includes("mdx-widget-"))).toHaveLength(1);
      expect(scripts.some((url) => url.includes("mdx-document-"))).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
    }
  });

  test("keeps widget geometry and following prose stable during interaction", async () => {
    for (const mode of ["islands", "react"]) {
      for (const width of [1200, 360]) {
        const { page: page_, errors } = await page();
        try {
          await page_.setViewportSize({ width, height: 800 });
          await page_.goto(`${origin}/${mode}/docs/counter`, { waitUntil: "networkidle" });
          const elements = [
            page_.getByRole("region", { name: "Counter demo" }),
            page_.getByRole("complementary"),
          ];
          const measure = () =>
            Promise.all(
              elements.map((element) =>
                element.evaluate((element_) => {
                  const bounds = element_.getBoundingClientRect();
                  return {
                    top: bounds.top + window.scrollY,
                    left: bounds.left + window.scrollX,
                    width: bounds.width,
                    height: bounds.height,
                  };
                }),
              ),
            );
          const before = await measure();
          for (let count = 0; count < 12; count++) {
            await page_.getByRole("button", { name: "Increment", exact: true }).click();
          }
          await vi.waitFor(async () =>
            expect(await page_.getByRole("status", { name: "Count" }).textContent()).toBe("12"),
          );
          expect(await measure()).toEqual(before);
          expect(errors).toEqual([]);
        } finally {
          await page_.close();
        }
      }
    }
  });

  test("defers widget entries until visible and needs no document or widget modules for prose-only pages", async () => {
    const { page: page_, errors, scripts } = await page();
    try {
      await page_.goto(`${origin}/islands/docs/writing`, { waitUntil: "networkidle" });
      expect(scripts.some((url) => /mdx-widget-|mdx-document-/.test(url))).toBe(false);
      scripts.length = 0;
      await page_.setViewportSize({ width: 1200, height: 240 });
      await page_.goto(`${origin}/islands/docs/loading`, { waitUntil: "networkidle" });
      expect(scripts.some((url) => /mdx-widget-|mdx-document-/.test(url))).toBe(false);
      const quiz = page_.getByRole("region", { name: "Knowledge check" });
      await quiz.scrollIntoViewIfNeeded();
      await page_.locator('[data-cq-strategy="visible"][data-cq-mounted="true"]').waitFor();
      await quiz.getByRole("button", { name: "When it becomes visible", exact: true }).click();
      await vi.waitFor(async () =>
        expect(await quiz.getByRole("status").textContent()).toContain("Correct"),
      );
      expect(scripts.filter((url) => url.includes("mdx-widget-")).length).toBe(1);
      expect(scripts.some((url) => url.includes("mdx-document-"))).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
    }
  });

  test("reports actual script response bytes and full-page transfers in both modes", async () => {
    for (const mode of ["islands", "react"]) {
      const { page: page_, errors } = await page();
      const scriptBodies: Promise<number>[] = [];
      const documentBodies: Promise<number>[] = [];
      page_.on("response", (response) => {
        if (/\.[cm]?js$/.test(new URL(response.url()).pathname)) {
          const size = response.body().then((body) => body.byteLength);
          scriptBodies.push(size);
          if (response.url().includes("mdx-document-")) {
            documentBodies.push(size);
          }
        }
      });
      try {
        await page_.goto(`${origin}/${mode}/docs/counter`, { waitUntil: "networkidle" });
        const javascript = (await Promise.all(scriptBodies)).reduce(
          (total, size) => total + size,
          0,
        );
        const document = (await Promise.all(documentBodies)).reduce(
          (total, size) => total + size,
          0,
        );
        const observed = await page_.evaluate(() => {
          const entries = [
            ...performance.getEntriesByType("navigation"),
            ...performance.getEntriesByType("resource"),
          ] as PerformanceResourceTiming[];
          return {
            requests: entries.length,
            transferred: entries.reduce((total, entry) => total + entry.transferSize, 0),
          };
        });
        const metrics = page_.locator('.load-metrics[data-scope="page-load"]');
        await vi.waitFor(async () => {
          expect(await metrics.getAttribute("data-js-bytes")).toBe(String(javascript));
          expect(await metrics.getAttribute("data-mdx-bytes")).toBe(String(document));
          expect(await metrics.getAttribute("data-transfer-bytes")).toBe(
            String(observed.transferred),
          );
          expect(await metrics.getAttribute("data-request-count")).toBe(String(observed.requests));
        });
        expect(javascript).toBeGreaterThan(0);
        expect(mode === "islands" ? document === 0 : document > 0).toBe(true);
        expect(await metrics.locator("summary").textContent()).not.toContain("Dev ·");
        await metrics.getByText("Full page load:", { exact: false }).click();
        expect(await metrics.getByRole("button", { name: "Reload page" }).isVisible()).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await page_.close();
      }
    }
  });

  test("keeps the active mode unchanged without fetching or increasing measured transfers", async () => {
    for (const mode of ["islands", "react"]) {
      const { page: page_, errors } = await page();
      try {
        await page_.goto(`${origin}/${mode}/docs/counter`, { waitUntil: "networkidle" });
        await page_.getByRole("button", { name: "Increment", exact: true }).click();
        await vi.waitFor(async () =>
          expect(
            await page_
              .getByRole("region", { name: "Counter demo" })
              .getByRole("status", { name: "Count" })
              .textContent(),
          ).toBe("1"),
        );
        const metrics = page_.locator(".load-metrics[data-scope]");
        const before = {
          transferred: await metrics.getAttribute("data-transfer-bytes"),
          requests: await metrics.getAttribute("data-request-count"),
          scope: await metrics.getAttribute("data-scope"),
          historyLength: await page_.evaluate(() => history.length),
        };
        const routeRequests: string[] = [];
        page_.on("request", (request) => {
          if (new URL(request.url()).pathname.endsWith(".data")) {
            routeRequests.push(request.url());
          }
        });
        const activeMode = page_
          .getByRole("navigation", { name: "Rendering mode" })
          .getByRole("link", { name: mode === "islands" ? "Islands" : "React", exact: true });
        for (let attempt = 0; attempt < 3; attempt++) {
          await activeMode.click();
        }
        await activeMode.focus();
        await page_.keyboard.press("Enter");
        await page_.waitForLoadState("networkidle");

        expect(routeRequests).toEqual([]);
        expect(await metrics.getAttribute("data-transfer-bytes")).toBe(before.transferred);
        expect(await metrics.getAttribute("data-request-count")).toBe(before.requests);
        expect(await metrics.getAttribute("data-scope")).toBe(before.scope);
        expect(await page_.getByRole("status", { name: "Count" }).textContent()).toBe("1");
        expect(await page_.evaluate(() => history.length)).toBe(before.historyLength);
        expect(errors).toEqual([]);
      } finally {
        await page_.close();
      }
    }
  });

  test("separates full reloads from navigation and observes deferred widget imports", async () => {
    const { page: page_, errors } = await page();
    const metrics = page_.locator(".load-metrics[data-scope]");
    const modes = page_.getByRole("navigation", { name: "Rendering mode" });
    try {
      await page_.goto(`${origin}/islands/docs/writing`, { waitUntil: "networkidle" });
      await modes.getByRole("link", { name: "React", exact: true }).click();
      await vi.waitFor(async () => {
        expect(await metrics.getAttribute("data-scope")).toBe("navigation");
        expect(Number(await metrics.getAttribute("data-mdx-bytes"))).toBeGreaterThan(0);
      });
      await modes.getByRole("link", { name: "Islands", exact: true }).click();
      await page_.waitForURL(`${origin}/islands/docs/writing`);
      await vi.waitFor(async () => {
        expect(await metrics.getAttribute("data-scope")).toBe("navigation");
        expect(await metrics.getAttribute("data-js-bytes")).toBe("0");
        expect(Number(await metrics.getAttribute("data-transfer-bytes"))).toBeGreaterThan(0);
      });
      await page_.goBack();
      await page_.waitForURL(`${origin}/react/docs/writing`);
      await vi.waitFor(async () => {
        expect(await metrics.getAttribute("data-scope")).toBe("navigation");
        expect(await metrics.getAttribute("data-js-bytes")).toBe("0");
        expect(await metrics.getAttribute("data-mdx-bytes")).toBe("0");
      });
      expect(await metrics.locator("summary").textContent()).toContain(
        "Additional navigation load:",
      );
      await page_.reload({ waitUntil: "networkidle" });
      await vi.waitFor(async () => {
        expect(await metrics.getAttribute("data-scope")).toBe("page-load");
        expect(Number(await metrics.getAttribute("data-js-bytes"))).toBeGreaterThan(0);
        expect(Number(await metrics.getAttribute("data-mdx-bytes"))).toBeGreaterThan(0);
      });
      expect(await metrics.locator("summary").textContent()).toContain("Full page load:");
      await modes.getByRole("link", { name: "Islands", exact: true }).click();
      await page_.setViewportSize({ width: 1200, height: 240 });
      await page_.locator('nav[aria-label="Guides"] a[href="/islands/docs/loading"]').click();
      await page_.waitForURL(`${origin}/islands/docs/loading`);
      await vi.waitFor(async () => {
        expect(await metrics.getAttribute("data-js-bytes")).toBe("0");
        expect(Number(await metrics.getAttribute("data-transfer-bytes"))).toBeGreaterThan(0);
      });
      const before = Number(await metrics.getAttribute("data-transfer-bytes"));
      const quiz = page_.getByRole("region", { name: "Knowledge check" });
      await quiz.scrollIntoViewIfNeeded();
      await page_.locator('[data-cq-strategy="visible"][data-cq-mounted="true"]').waitFor();
      await vi.waitFor(async () => {
        expect(Number(await metrics.getAttribute("data-js-bytes"))).toBeGreaterThan(0);
        expect(Number(await metrics.getAttribute("data-transfer-bytes"))).toBeGreaterThan(before);
      });
      await quiz.getByRole("button", { name: "When it becomes visible", exact: true }).click();
      await vi.waitFor(async () =>
        expect(await quiz.getByRole("status").textContent()).toContain("Correct"),
      );
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
    }
  });

  test("hydrates React documents and navigates between modes without reloading", async () => {
    const { page: page_, errors } = await page();
    try {
      await page_.goto(`${origin}/react/docs/counter`, { waitUntil: "networkidle" });
      await page_.evaluate(() => {
        (window as unknown as { navigationMarker: string }).navigationMarker = "preserved";
      });
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      await vi.waitFor(async () =>
        expect(
          await page_
            .getByRole("region", { name: "Counter demo" })
            .getByRole("status", { name: "Count" })
            .textContent(),
        ).toBe("1"),
      );
      await page_.locator('nav[aria-label="Guides"] a[href="/react/docs/writing"]').click();
      await page_.getByRole("heading", { name: "Writing a useful guide", exact: true }).waitFor();
      expect(
        await page_.evaluate(
          () => (window as unknown as { navigationMarker: string }).navigationMarker,
        ),
      ).toBe("preserved");
      await page_.goBack();
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      await vi.waitFor(async () =>
        expect(
          await page_
            .getByRole("region", { name: "Counter demo" })
            .getByRole("status", { name: "Count" })
            .textContent(),
        ).toBe("1"),
      );
      const modeNavigation = page_.getByRole("navigation", { name: "Rendering mode" });
      await modeNavigation.getByRole("link", { name: "Islands", exact: true }).click();
      await vi.waitFor(async () =>
        expect(
          await modeNavigation
            .getByRole("link", { name: "Islands", exact: true })
            .getAttribute("aria-current"),
        ).toBe("page"),
      );
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      expect(
        await page_.evaluate(
          () => (window as unknown as { navigationMarker: string }).navigationMarker,
        ),
      ).toBe("preserved");
      expect(await page_.title()).toContain("A simple counter");
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
    }
  });

  test("keeps the document usable at a narrow viewport", async () => {
    const { page: page_, errors } = await page();
    try {
      await page_.setViewportSize({ width: 360, height: 760 });
      await page_.goto(`${origin}/islands/docs/counter`, { waitUntil: "networkidle" });
      expect(
        await page_.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
    }
  });

  test("leaves modified clicks, external links, hashes, targets, and downloads to the browser", async () => {
    const { page: page_, errors } = await page();
    try {
      await page_.goto(`${origin}/islands/docs/writing`, { waitUntil: "networkidle" });
      const intercepted = await page_.evaluate(() => {
        const results: boolean[] = [];
        document.addEventListener("click", (event) => {
          results.push(event.defaultPrevented);
          event.preventDefault();
        });
        for (const options of [
          { href: "/islands/docs/loading", ctrlKey: true },
          { href: "/islands/docs/loading", metaKey: true },
          { href: "/islands/docs/loading", shiftKey: true },
          { href: "/islands/docs/loading", button: 1 },
          { href: "https://example.com/" },
          { href: "#" },
          { href: "#a-good-example-starts-with-a-question" },
          { href: "/islands/docs/loading", download: "guide.html" },
          { href: "/islands/docs/loading", target: "_blank" },
        ]) {
          const link = document.createElement("a");
          link.href = options.href;
          if (options.download) {
            link.download = options.download;
          }
          if (options.target) {
            link.target = options.target;
          }
          document.body.append(link);
          link.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true, ...options }),
          );
          link.remove();
        }
        return results;
      });
      expect(intercepted).toEqual(Array.from({ length: 9 }, () => false));
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
    }
  });

  test("ignores a delayed navigation response after a newer page has been displayed", async () => {
    const { page: page_, errors } = await page();
    let release: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    try {
      await page_.goto(`${origin}/islands/docs/counter`, { waitUntil: "networkidle" });
      await page_.route("**/islands/docs/loading.data*", async (route) => {
        requested!();
        await delayed;
        await route.continue().catch(() => {});
      });
      await page_.locator('nav[aria-label="Guides"] a[href="/islands/docs/loading"]').click();
      await started;
      await page_.locator('nav[aria-label="Guides"] a[href="/islands/docs/writing"]').click();
      await page_.getByRole("heading", { name: "Writing a useful guide", exact: true }).waitFor();
      release!();
      await page_.waitForLoadState("networkidle");
      expect(new URL(page_.url()).pathname).toBe("/islands/docs/writing");
      expect(await page_.title()).toContain("Writing a useful guide");
      expect(await page_.locator("[data-cq-island]").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      release!();
      await page_.close();
    }
  });

  test("runs the documented development command with working SSR and both React lifecycles", async () => {
    const developmentRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "cq-mdx-development-")),
    );
    let development: ChildProcess | undefined;
    const { page: page_, errors } = await page();
    try {
      await copyExample(developmentRoot);
      // Linked test dependencies live outside the temporary Vite root; real installs do not.
      await writeFile(
        path.join(developmentRoot, "vite.config.ts"),
        `import config from ${JSON.stringify(pathToFileURL(path.join(appRoot, "vite.config.ts")).href)};\nexport default {...config,server:{fs:{allow:${JSON.stringify([developmentRoot, path.resolve(appRoot, "../..")])}}}};`,
      );
      const port = await availablePort();
      const url = `http://127.0.0.1:${port}`;
      development = spawn("vp", ["run", "dev", "--host", "127.0.0.1", "--port", String(port)], {
        cwd: developmentRoot,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let output = "";
      development.stdout!.on("data", (data: Buffer) => {
        output += data.toString();
      });
      development.stderr!.on("data", (data: Buffer) => {
        output += data.toString();
      });
      await vi.waitFor(
        async () => {
          const response = await fetch(`${url}/islands/docs/counter`);
          expect(response.status, output).toBe(200);
        },
        { timeout: 20_000 },
      );
      await page_.goto(`${url}/islands/docs/counter`, { waitUntil: "networkidle" });
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      expect(errors).toEqual([]);
      const modeNavigation = page_.getByRole("navigation", { name: "Rendering mode" });
      await modeNavigation.getByRole("link", { name: "React", exact: true }).click();
      await vi.waitFor(async () =>
        expect(
          await modeNavigation
            .getByRole("link", { name: "React", exact: true })
            .getAttribute("aria-current"),
        ).toBe("page"),
      );
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      await vi.waitFor(async () => {
        expect(
          await page_
            .getByRole("region", { name: "Counter demo" })
            .getByRole("status", { name: "Count" })
            .textContent(),
        ).toBe("1");
      });
      await modeNavigation.getByRole("link", { name: "Islands", exact: true }).click();
      await page_.locator('[data-cq-strategy="load"][data-cq-mounted="true"]').waitFor();
      await page_.getByRole("button", { name: "Increment", exact: true }).click();
      expect(errors).toEqual([]);
    } finally {
      await page_.close();
      await stopServer(development);
      await rm(developmentRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
