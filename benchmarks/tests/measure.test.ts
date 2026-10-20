import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { clearCaches, verifyStaticOutput } from "../scripts/measure.ts";
import { apps, command } from "../scripts/config.ts";

describe("cold application caches", () => {
  test("removes native framework caches while preserving dependencies and source content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-caches-"));
    const caches = [
      ".astro",
      ".nuxt",
      ".next",
      ".data",
      ".output",
      ".content-query",
      ".tanstack",
      ".content-collections",
      ".prerender",
      ".void",
      "dist",
      "out",
      "node_modules/.astro",
      "node_modules/.cache/vite",
      "node_modules/.vite",
      "node_modules/.vite-temp",
    ];
    try {
      for (const directory of [...caches, "content/entries", "node_modules/dependency"]) {
        await mkdir(path.join(root, directory), { recursive: true });
        await writeFile(path.join(root, directory, "entry.txt"), directory);
      }
      await writeFile(path.join(root, "void.lock.json"), "{}");
      await writeFile(path.join(root, ".void-wrangler.jsonc"), "{}");
      await mkdir(path.join(root, "src/routes"), { recursive: true });
      await writeFile(path.join(root, "src/routeTree.gen.ts"), "generated routes");
      await writeFile(path.join(root, "src/routes/index.tsx"), "source route");
      await clearCaches(root);
      for (const directory of caches) {
        await expect(stat(path.join(root, directory))).rejects.toMatchObject({ code: "ENOENT" });
      }
      await expect(stat(path.join(root, "void.lock.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(path.join(root, ".void-wrangler.jsonc"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(path.join(root, "src/routeTree.gen.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(path.join(root, "src/routes/index.tsx"), "utf8")).toBe("source route");
      expect(await readFile(path.join(root, "content/entries/entry.txt"), "utf8")).toBe(
        "content/entries",
      );
      expect(await readFile(path.join(root, "node_modules/dependency/entry.txt"), "utf8")).toBe(
        "node_modules/dependency",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("full-site build validation", () => {
  test("uses the commands that include React prerendering and Nuxt generation", () => {
    expect(command(apps[1], "build")).toEqual(["run", "--no-cache", "build"]);
    expect(command(apps[2], "build")).toEqual(["exec", "nuxt", "generate"]);
  });

  test("uses native Next.js commands, hostname flags, and its static export preview", () => {
    const next = apps.find((app) => app.id === "next")!;
    expect(command(next, "build")).toEqual(["exec", "next", "build"]);
    expect(command(next, "dev", 4321)).toEqual([
      "exec",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "4321",
    ]);
    expect(command(next, "preview", 4321)).toEqual([
      "exec",
      "node",
      "../../shared/preview.ts",
      "--dir",
      "out",
      "--host",
      "127.0.0.1",
      "--port",
      "4321",
    ]);
  });

  test.each(["valid", "missing-page", "client-shell", "wrong-article"] as const)(
    "audits every static item page: %s",
    async (variant) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-static-pages-"));
      const app = apps[0];
      const output = path.join(root, "apps", app.id, app.staticOutput);
      try {
        await mkdir(path.join(output, "entries/entry-00001"), { recursive: true });
        await writeFile(
          path.join(output, "index.html"),
          '<a href="/entries/entry-00001/">Benchmark entry 00001</a>',
        );
        if (variant !== "missing-page") {
          await writeFile(
            path.join(output, "entries/entry-00001/index.html"),
            variant === "client-shell"
              ? '<div id="root"></div><script src="/app.js"></script>'
              : `<main data-benchmark-entry="entry-00001"><article><h2>Benchmark article 00001</h2><p>Dataset marker entry-${variant === "wrong-article" ? "00002" : "00001"}.</p></article></main>`,
          );
        }
        if (variant === "valid") {
          expect(await verifyStaticOutput(app, root, 1)).toBe(2);
        } else {
          await expect(verifyStaticOutput(app, root, 1)).rejects.toThrow();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
