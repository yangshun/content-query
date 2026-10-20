import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { createFixture, removeFixture, serverOrigin, startProcess, stopProcess } from "./fixture";

describe("Angular CLI development content integration", () => {
  test("rebuilds server queries after metadata, body, nested route, and configuration edits", async () => {
    const root = await createFixture();
    const packageFile = path.join(root, "package.json");
    const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
    packageJson.scripts.dev = packageJson.scripts.dev.replace(
      '"ng serve"',
      '"ng serve --host 127.0.0.1 --port 0"',
    );
    await writeFile(packageFile, JSON.stringify(packageJson));
    const server = startProcess(root, "vp", ["run", "dev"]);
    try {
      const origin = await serverOrigin(server);
      const waits = { timeout: 20_000, interval: 200 };
      const request = (route: string) =>
        fetch(`${origin}${route}`).then((response) => response.text());
      expect(await request("/docs/getting-started/")).toContain("Start with a workspace");
      const post = path.join(root, "content/guides/getting-started.md");
      const original = await readFile(post, "utf8");
      await writeFile(
        post,
        `${original.replace("title: Getting started", "title: Updated guide")}\n## Body edit\nChanged through the content watcher.\n`,
      );
      await vi.waitFor(async () => {
        const html = await request("/docs/getting-started/");
        expect(html).toContain("Updated guide");
        expect(html).toContain("Changed through the content watcher.");
      }, waits);
      const added = path.join(root, "content/guides/reference/new-guide.md");
      await writeFile(
        added,
        "---\ntitle: New nested guide\ndescription: Added during development.\norder: 5\n---\n## New nested page\nNested content.\n",
      );
      await vi.waitFor(async () => {
        expect(await request("/docs/reference/new-guide/")).toContain("New nested page");
      }, waits);
      await rename(added, path.join(root, "content/guides/reference/renamed.md"));
      await vi.waitFor(async () => {
        expect(await request("/docs/reference/renamed/")).toContain("New nested page");
        expect((await fetch(`${origin}/docs/reference/new-guide/`)).status).toBe(404);
      }, waits);
      await rm(path.join(root, "content/guides/reference/renamed.md"));
      await vi.waitFor(async () => {
        expect(await request("/")).not.toContain("New nested guide");
      }, waits);
      const configuration = path.join(root, "content-query.config.ts");
      const originalConfiguration = await readFile(configuration, "utf8");
      await writeFile(
        configuration,
        originalConfiguration.replace(
          "title: schema.string()",
          "title: schema.string().transform((title) => `Configured ${title}`)",
        ),
      );
      await vi.waitFor(async () => {
        expect(await request("/docs/getting-started/")).toContain("Configured Updated guide");
      }, waits);
    } catch (error) {
      console.error(server.output().slice(-6_000));
      throw error;
    } finally {
      await stopProcess(server);
      await removeFixture(root);
    }
  }, 120_000);
});
