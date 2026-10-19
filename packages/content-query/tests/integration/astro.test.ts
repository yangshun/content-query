import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { prepareAtRoot } from "../../src/preparation/build.ts";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

describe("published Astro loaders in real consumers", () => {
  test("prepares through public exports and deploys without Astro, the loader, configuration, or sources", async () => {
    const fixture = await projectFixture();
    try {
      await mkdir(path.join(fixture.root, "node_modules/@ascorbic"));
      await symlink(
        await realpath(path.join(packageRoot, "node_modules/@ascorbic/csv-loader")),
        path.join(fixture.root, "node_modules/@ascorbic/csv-loader"),
        "dir",
      );
      await writeFile(path.join(fixture.root, "authors.csv"), "id,name\nada,Ada\n");
      await writeFile(
        fixture.config,
        `
import { defineCollection } from "content-query";
import { csvLoader } from "@ascorbic/csv-loader";
import { z } from "zod";
export const collections = {
  authors: defineCollection({
    loader: csvLoader({fileName:"./authors.csv",idField:"id"}),
    schema: z.object({name:z.string().transform(name=>name+"!")}),
  }),
};
`,
      );
      await (await prepareAtRoot(fixture.root, {})).dispose();
      const server = await readFile(path.join(fixture.root, ".content-query/server.js"), "utf8");
      expect(server).not.toMatch(/astro|csv-loader|content-query\.config|zod/);
      await writeFile(
        path.join(fixture.root, "consumer.ts"),
        `
import { content } from "./.content-query/server.js";
const authors: Promise<{id:string;name:string}[]> = content.query("authors").select("id","name").all();
// @ts-expect-error Source schema inference survives the loader and generated declarations.
content.query("authors").select("missing");
void authors;
`,
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
        { cwd: fixture.root },
      );
      await rm(fixture.config);
      await rm(path.join(fixture.root, "authors.csv"));
      await rm(path.join(fixture.root, "node_modules/@ascorbic"), { recursive: true });
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
import {registerHooks} from "node:module";
registerHooks({resolve(specifier,context,next){
  if (["astro", "@ascorbic", "zod"].some(name => specifier === name || specifier.startsWith(name+"/"))) {
    throw new Error("Preparation dependency imported at runtime: "+specifier);
  }
  return next(specifier,context);
}});
const {content}=await import("./.content-query/server.js");
console.log(JSON.stringify(await content.query("authors").select("id","name").all()));
`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual([{ id: "ada", name: "Ada!" }]);
    } finally {
      await fixture.dispose();
    }
  });
});
