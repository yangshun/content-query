import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { buildAtRoot } from "../../src/preparation/build.ts";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

describe("published Astro loaders in real consumers", () => {
  test(
    "prepares through public exports and deploys without Astro, the loader, configuration, or sources",
    { timeout: 30_000 },
    async () => {
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
import { schema } from "content-query/schema";
export const collections = {
  authors: defineCollection({
    loader: csvLoader({fileName:"./authors.csv",idField:"id"}),
    schema: schema.object({name:schema.string().transform(name=>name+"!")}),
  }),
};
`,
        );
        await (await buildAtRoot(fixture.root, {})).dispose();
        const server = await readFile(
          path.join(fixture.root, ".content-query/collections/authors/server.js"),
          "utf8",
        );
        expect(server).not.toMatch(/astro|csv-loader|content-query\.config|zod/);
        await writeFile(
          path.join(fixture.root, "consumer.ts"),
          `
import { authors } from "./.content-query/collections/authors/server.js";
const rows: Promise<{id:string;name:string}[]> = authors.select("id", "name").all();
// @ts-expect-error Source schema inference survives the loader and generated declarations.
authors.select("missing");
void rows;
`,
        );
        await execute(
          process.execPath,
          [
            path.join(packageRoot, "node_modules/tsrs/bin/tsrs"),
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
const {authors}=await import("./.content-query/collections/authors/server.js");
console.log(JSON.stringify(await authors.select("id", "name").all()));
`,
          ],
          { cwd: fixture.root },
        );
        expect(JSON.parse(stdout)).toEqual([{ id: "ada", name: "Ada!" }]);
      } finally {
        await fixture.dispose();
      }
    },
  );
});
