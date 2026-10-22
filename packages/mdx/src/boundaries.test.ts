import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import * as companion from "./index.ts";
import { compileMdx } from "./compiler.ts";
import type { MdxModule } from "./types.ts";

describe("MDX public package and framework boundaries", () => {
  test("typechecks core and MDX plugins together with the host's Vite+ types", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cq-mdx-vite-types-"));
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const execute = promisify(execFile);
    try {
      await symlink(
        fileURLToPath(new URL("../../../examples/react-router-mdx/node_modules", import.meta.url)),
        path.join(root, "node_modules"),
        "dir",
      );
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await writeFile(
        path.join(root, "consumer.ts"),
        `import {defineConfig, type Plugin} from "vite-plus";
import {contentQuery} from "content-query/vite";
import {contentQueryMdx} from "@content-query/mdx/vite";
const core = contentQuery() satisfies Plugin;
const unsubscribe = core.api.subscribe(() => {});
unsubscribe();
export const config = defineConfig({plugins:[core, contentQueryMdx({rendering:"both"})]});`,
      );
      await execute(
        process.execPath,
        [
          path.join(packageRoot, "node_modules/typescript/bin/tsc"),
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
          "consumer.ts",
        ],
        { cwd: root },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  test("ships usable public entries and types without source files or Vite+ in the consumer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cq-mdx-packed-"));
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const execute = promisify(execFile);
    try {
      const archive = path.join(root, "mdx.tgz");
      const installed = path.join(root, "node_modules/@content-query/mdx");
      await execute("vp", ["pm", "pack", "--out", archive, "--json"], { cwd: packageRoot });
      await mkdir(installed, { recursive: true });
      await execute("tar", ["-xzf", archive, "-C", installed, "--strip-components=1"]);
      const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")) as {
        exports: Record<string, string>;
        dependencies: Record<string, string>;
      };
      for (const filename of Object.values(manifest.exports)) {
        expect(filename).not.toContain("/src/");
        await readFile(path.join(installed, filename));
      }
      expect(await readFile(path.join(installed, "LICENSE"), "utf8")).toBe(
        await readFile(path.join(packageRoot, "LICENSE"), "utf8"),
      );
      for (const [, target] of (await readFile(path.join(installed, "README.md"), "utf8")).matchAll(
        /\]\(([^)]+)\)/g,
      )) {
        expect(target).toMatch(/^https:\/\//);
      }
      for (const dependency of new Set([
        ...Object.keys(manifest.dependencies),
        "content-query",
        "react",
        "react-dom",
        "vite",
        "@types/node",
        "@types/react",
        "@types/react-dom",
      ])) {
        const destination = path.join(root, "node_modules", dependency);
        await mkdir(path.dirname(destination), { recursive: true });
        await symlink(
          await realpath(path.join(packageRoot, "node_modules", dependency)),
          destination,
          "dir",
        );
      }
      await expect(realpath(path.join(root, "node_modules/vite-plus"))).rejects.toThrow();
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await writeFile(
        path.join(root, "consumer.ts"),
        `import {defineConfig} from "vite";
import {mdx} from "@content-query/mdx";
import {compileMdx} from "@content-query/mdx/compiler";
import {contentQueryMdx} from "@content-query/mdx/vite";
import {mountIslands} from "@content-query/mdx/client";
import {renderMdxModule} from "@content-query/mdx/react/server";
import {createMdxAssets} from "@content-query/mdx/assets";
mdx({base:"content"});
compileMdx({path:"hello.mdx",value:"# Hello"});
mountIslands(document);
void renderMdxModule;
void createMdxAssets;
export default defineConfig({plugins:[contentQueryMdx()]});`,
      );
      await execute(
        process.execPath,
        [
          path.join(packageRoot, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--module",
          "nodenext",
          "--target",
          "esnext",
          "consumer.ts",
        ],
        { cwd: root },
      );
      await writeFile(
        path.join(root, "runtime.mjs"),
        'import {compileMdx} from "@content-query/mdx/compiler"; const result=await compileMdx({path:"hello.mdx",value:"# Hello"},{highlight:false}); if(result.headings[0].slug!=="hello")throw new Error("Invalid heading");',
      );
      await execute(process.execPath, ["runtime.mjs"], { cwd: root });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  test("keeps core and browser-safe entries independent of MDX compilation and standalone SSR", async () => {
    expect(companion.mdx).toBeTypeOf("function");
    const core = JSON.parse(
      await readFile(new URL("../../content-query/package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(core.dependencies).some((name) => /mdx|^react(?:-dom)?$/.test(name))).toBe(
      false,
    );
    for (const entry of ["index", "assets", "client", "react", "react/client"]) {
      const output = await readFile(new URL(`../dist/${entry}.mjs`, import.meta.url), "utf8");
      expect(output).not.toMatch(/react-dom\/server|@mdx-js|shiki|from ["']vite/);
      if (entry === "client") {
        expect(output).not.toMatch(/from ["']react(?:-dom)?(?:\/[^"']+)?["']/);
      }
    }
    for (const entry of ["react", "react/client"]) {
      const code = await readFile(new URL(`../dist/${entry}.mjs`, import.meta.url), "utf8");
      expect(code).toMatch(/^"use client";/);
      expect(code.match(/["']use client["'];/g)).toHaveLength(1);
    }
    expect(await readFile(new URL("../dist/vite.d.mts", import.meta.url), "utf8")).not.toContain(
      'from "vite-plus"',
    );
  });

  test("loads ordinary compiled ESM with exports, expressions, imported components, and overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cq-mdx-esm-"));
    try {
      await symlink(
        fileURLToPath(new URL("../node_modules", import.meta.url)),
        path.join(root, "node_modules"),
        "dir",
      );
      await writeFile(
        path.join(root, "widget.mjs"),
        '"use client";import {createElement} from "react";export default function Widget({label}){return createElement("button",null,label)}',
      );
      const compiled = await compileMdx(
        {
          path: path.join(root, "article.mdx"),
          value:
            'import Widget from "./widget.mjs";\nimport headings from "./widget.mjs";\n\nexport const answer = 42;\nexport const __cq_headings = "Authored export";\n\n# A heading\n\nThe answer is {answer}.\n\n{headings.name}\n\n<Widget label="Imported component" />',
        },
        { highlight: false },
      );
      expect(compiled.code).not.toMatch(/vite|hydrateRoot|createRoot|@content-query\/mdx/);
      await writeFile(path.join(root, "article.mjs"), compiled.code);
      const module = (await import(
        /* @vite-ignore */ pathToFileURL(path.join(root, "article.mjs")).href
      )) as MdxModule;
      expect(module.answer).toBe(42);
      expect(module.__cq_headings).toBe("Authored export");
      const html = renderToString(
        createElement(module.default, {
          components: {
            h1: (props) => createElement("h1", { ...props, className: "custom-heading" }),
          },
        }),
      );
      expect(html).toContain('id="a-heading" class="custom-heading"');
      expect(html).toContain("The answer is <!-- -->42");
      expect(html).toContain("Imported component");
      expect(await readFile(path.join(root, "widget.mjs"), "utf8")).toMatch(/^"use client";/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
