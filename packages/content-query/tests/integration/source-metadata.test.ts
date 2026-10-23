import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { buildAtRoot } from "../../src/preparation/build.ts";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

describe("loader source metadata through public package exports", () => {
  test("infers custom and built-in metadata and deploys only computed results", async () => {
    const fixture = await projectFixture();
    try {
      await writeFile(
        fixture.config,
        `import { defineCollection } from "content-query";
import { file, glob, type Loader } from "content-query/loaders";
import { schema } from "content-query/schema";
const cms: Loader<{documentId:string;url:string;secret:string}> = {
  name: "typed-cms",
  async load({store}) {
    store.set({id:"remote",data:{title:"Remote"},source:{documentId:"doc-one",url:"/remote",secret:"private-source-only"}});
  },
};
export const collections = {
  posts: defineCollection({
    loader: glob({base:"./content/posts",pattern:"*.md",generateId:()=>"custom-id"}),
    computed: {sourceFile:{schema:schema.string().optional(),resolve:({source})=>source?.filePath}},
  }),
  authors: defineCollection({
    loader: file("./content/authors.json"),
    computed: {recordKey:{schema:schema.string().optional(),resolve:({source})=>source?.key}},
  }),
  remote: defineCollection({
    loader: cms,
    schema: schema.object({title:schema.string()}),
    computed: {
      url: {
        schema:schema.string(),
        resolve: ({data,source}) => {
          const title: string = data.title;
          if (!source) { return title; }
          const documentId: string = source.documentId;
          if (false) {
            // @ts-expect-error The custom loader does not expose a file path.
            void source.filePath;
            // @ts-expect-error Source fields preserve their declared value types.
            const wrong: number = source.url;
            void wrong;
          }
          return documentId ? source.url : title;
        },
      },
    },
  }),
};
`,
      );
      await (await buildAtRoot(fixture.root, {})).dispose();
      await writeFile(
        path.join(fixture.root, "consumer.ts"),
        `import { content } from "./.content-query/server.js";
const files: Promise<{sourceFile:string|undefined}[]> = content.select("sourceFile").from("posts").all();
const keys: Promise<{recordKey:string|undefined}[]> = content.select("recordKey").from("authors").all();
const urls: Promise<{url:string}[]> = content.select("url").from("remote").all();
// @ts-expect-error Source metadata is not an implicit query field.
content.select("source").from("remote");
void [files, keys, urls];
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
          "--allowImportingTsExtensions",
          "consumer.ts",
        ],
        { cwd: fixture.root },
      );
      const generated = path.join(fixture.root, ".content-query");
      const modules = await Promise.all(
        (await readdir(generated, { recursive: true }))
          .filter((filename) => filename.endsWith(".js"))
          .map((filename) => readFile(path.join(generated, filename), "utf8")),
      );
      expect(modules.join("\n")).not.toContain("private-source-only");
      await rm(fixture.config);
      await rm(path.join(fixture.root, "content"), { recursive: true });
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const {content}=await import("./.content-query/server.js"); console.log(JSON.stringify({
posts:await content.select("id", "sourceFile").from("posts").all(),
authors:await content.select("recordKey").from("authors").all(),
remote:await content.select("url").from("remote").all(),
}));`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({
        posts: [{ id: "custom-id", sourceFile: "content/posts/Getting Started.md" }],
        authors: [{ recordKey: "0" }],
        remote: [{ url: "/remote" }],
      });
    } finally {
      await fixture.dispose();
    }
  });
});
