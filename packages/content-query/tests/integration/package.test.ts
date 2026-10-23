import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

/** Unpacks the distributable with production dependencies and, optionally, a host Vite runtime. */
async function packedFixture(withVite = false) {
  const fixture = await projectFixture();
  try {
    const archive = path.join(fixture.root, "content-query.tgz");
    await execute("vp", ["pm", "pack", "--out", archive, "--json"], { cwd: packageRoot });
    const installed = path.join(fixture.root, "node_modules/content-query");
    await rm(installed);
    await mkdir(installed);
    await execute("tar", ["-xzf", archive, "-C", installed, "--strip-components=1"]);
    const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
    for (const dependency of Object.keys(manifest.dependencies)) {
      const destination = path.join(fixture.root, "node_modules", dependency);
      await mkdir(path.dirname(destination), { recursive: true });
      await symlink(
        await realpath(path.join(packageRoot, "node_modules", dependency)),
        destination,
        "dir",
      );
    }
    if (withVite) {
      const require = createRequire(import.meta.url);
      const toolchain = createRequire(require.resolve("vite-plus/package.json"));
      const vite = path.dirname(toolchain.resolve("vite/package.json"));
      await symlink(vite, path.join(fixture.root, "node_modules/vite"), "dir");
    }
    return { ...fixture, installed, manifest };
  } catch (cause) {
    await fixture.dispose();
    throw cause;
  }
}

describe("packed package consumers", () => {
  test("typechecks the workspace plugin with the consuming app's Vite+ types", async () => {
    const fixture = await projectFixture();
    try {
      await symlink(
        await realpath(
          new URL("../../../../examples/react-router/node_modules/vite-plus", import.meta.url),
        ),
        path.join(fixture.root, "node_modules/vite-plus"),
        "dir",
      );
      await writeFile(
        path.join(fixture.root, "vite.config.ts"),
        `import { defineConfig, type Plugin } from "vite-plus";
import { contentQuery } from "content-query/vite";
const plugin = contentQuery() satisfies Plugin;
export default defineConfig({ plugins: [plugin] });`,
      );
      await execute(
        process.execPath,
        [
          path.join(packageRoot, "node_modules/tsrs/bin/tsrs"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--allowImportingTsExtensions",
          "--module",
          "esnext",
          "--moduleResolution",
          "bundler",
          "--target",
          "esnext",
          "vite.config.ts",
        ],
        { cwd: fixture.root },
      );
    } finally {
      await fixture.dispose();
    }
  }, 30_000);

  test(
    "typechecks the public Vite integration without Vite+ installed",
    { timeout: 30_000 },
    async () => {
      const fixture = await packedFixture(true);
      try {
        await expect(
          realpath(path.join(fixture.root, "node_modules/vite-plus")),
        ).rejects.toMatchObject({
          code: "ENOENT",
        });
        await writeFile(
          path.join(fixture.root, "vite.config.ts"),
          `import { defineConfig } from "vite";
import { contentQuery } from "content-query/vite";
export default defineConfig({ plugins: [contentQuery()] });`,
        );
        await execute(
          process.execPath,
          [
            path.join(packageRoot, "node_modules/tsrs/bin/tsrs"),
            "--noEmit",
            "--strict",
            "--module",
            "nodenext",
            "--target",
            "esnext",
            "vite.config.ts",
          ],
          { cwd: fixture.root },
        );
      } finally {
        await fixture.dispose();
      }
    },
  );

  test(
    "ships licensed, documented exports and runs without authored sources",
    { timeout: 30_000 },
    async () => {
      const fixture = await packedFixture();
      try {
        expect(fixture.manifest.private).not.toBe(true);
        expect(fixture.manifest.engines.node).toBeDefined();
        expect(fixture.manifest.repository.directory).toBe("packages/content-query");
        expect(await readFile(path.join(fixture.installed, "LICENSE"), "utf8")).toBe(
          await readFile(path.join(packageRoot, "../../LICENSE"), "utf8"),
        );
        for (const filename of Object.values(fixture.manifest.exports) as string[]) {
          await readFile(path.join(fixture.installed, filename));
        }
        const readme = await readFile(path.join(fixture.installed, "README.md"), "utf8");
        for (const [, target] of readme.matchAll(/\]\(([^)]+)\)/g)) {
          expect(target).toMatch(/^https:\/\//);
        }
        const cli = path.join(fixture.installed, "dist/cli.mjs");
        const version = await execute(process.execPath, [cli, "--version"], { cwd: fixture.root });
        expect(version.stdout).toContain(`content-query/${fixture.manifest.version}`);
        await execute(process.execPath, [cli, "build"], { cwd: fixture.root });
        await rename(fixture.config, `${fixture.config}.disabled`);
        await rename(
          path.join(fixture.root, "content"),
          path.join(fixture.root, "content.disabled"),
        );
        const result = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import { content } from "./.content-query/server.js";
const posts = await content.select("id", "title", "upper").from("posts").all();
const { html } = await content.render("posts", posts[0].id);
console.log(JSON.stringify({ posts, html }));`,
          ],
          { cwd: fixture.root },
        );
        const rendered = JSON.parse(result.stdout);
        expect(rendered.posts).toEqual([
          { id: "getting-started", title: "Getting started", upper: "GETTING STARTED" },
        ]);
        expect(rendered.html).toContain('<h1 id="hello">Hello</h1>');
      } finally {
        await fixture.dispose();
      }
    },
  );
});
