import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test, vi } from "vite-plus/test";
import { buildAtRoot } from "../../src/preparation/build.ts";
import { sessionInternals, type ContentSession } from "../../src/preparation/session.ts";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

describe("computed helpers through public package exports", () => {
  test.each(["in-memory", "generated"] as const)(
    "prepares Markdown, structured text, and loader metadata with the %s backend",
    async (backend) => {
      const fixture = await projectFixture();
      try {
        await writeFile(
          fixture.postPath,
          "---\ntitle: Hello\n---\n# Hello\n\nRead **this** [guide](https://example.com).\n",
        );
        await writeFile(
          path.join(fixture.root, "content/articles.json"),
          JSON.stringify([
            {
              id: "remote",
              description: "A short description",
              html: "<p>Remote <b>article</b> text.</p><script>ignored words</script>",
            },
          ]),
        );
        await writeFile(
          fixture.config,
          `import {defineCollection} from "content-query";
import {excerpt, readingTime, wordCount} from "content-query/computed";
import {file, glob, type Loader} from "content-query/loaders";
import { schema } from "content-query/schema";
const articleSchema = schema.object({description:schema.string(),html:schema.string()});
type Article = schema.infer<typeof articleSchema>;
const cms: Loader<{text:string}> = {
  name:"cms",
  async load({store}) {store.set({id:"one",data:{},source:{text:"Loaded metadata"}});},
};
export const collections = {
  posts: defineCollection({
    loader:glob({base:"./content/posts",pattern:"*.md",retainBody:false,deferRender:true}),
    schema:schema.object({title:schema.string()}),
    computed:{readingMinutes:readingTime(),words:wordCount(),summary:excerpt({maxLength:16})},
  }),
  articles: defineCollection({
    loader:file("./content/articles.json"),schema:articleSchema,
    computed:{
      words:wordCount<Article>({from:({data})=>data.html,format:"html"}),
      readingMinutes:readingTime<Article>({from:async ({data})=>data.description,format:"text"}),
      summary:excerpt<Article>({from:({data})=>data.description,format:"text"}),
    },
  }),
  cms:defineCollection({loader:cms,computed:{words:wordCount<{}, {text:string}>({from:({source})=>source?.text,format:"text"})}}),
};
`,
        );
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
const {buildContent}=await import("content-query/build");
const session=await buildContent({backend:${JSON.stringify(backend)}});
try {
  console.log(JSON.stringify({
    posts:await session.content.select("readingMinutes", "words", "summary").from("posts").all(),
    articles:await session.content.select("readingMinutes", "words", "summary").from("articles").all(),
    cms:await session.content.select("words").from("cms").all(),
    retainedBody:await session.content.readBody("posts","getting-started"),
  }));
} finally {await session.dispose();}
`,
          ],
          { cwd: fixture.root },
        );
        const expected = {
          posts: [{ readingMinutes: 1, words: 4, summary: "Hello Read this…" }],
          articles: [{ readingMinutes: 1, words: 3, summary: "A short description" }],
          cms: [{ words: 2 }],
        };
        expect(JSON.parse(stdout)).toEqual(expected);

        if (backend === "generated") {
          await writeFile(
            path.join(fixture.root, "consumer.ts"),
            `
import {content, type CollectionData} from "./.content-query/server.js";
const selected:Promise<{words:number;readingMinutes:number;summary:string}[]> = content.select("words", "readingMinutes", "summary").from("posts").all();
const words:CollectionData<"articles">["words"] = 3;
// @ts-expect-error Computed number fields do not become strings through generated declarations.
const wrong:CollectionData<"posts">["readingMinutes"] = "one";
void [selected,words,wrong];
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
          await rm(fixture.config);
          await rm(path.join(fixture.root, "content"), { recursive: true });
          const deployed = await execute(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `
import {registerHooks} from "node:module";
registerHooks({resolve(specifier,context,next){
  if (["content-query/computed","htmlparser2","reading-time","markdown-exit"].includes(specifier)) {
    throw new Error("Build-only helper imported by deployed queries: " + specifier);
  }
  return next(specifier,context);
}});
const {content}=await import("./.content-query/server.js");
console.log(JSON.stringify({
  posts:await content.select("readingMinutes", "words", "summary").from("posts").all(),
  articles:await content.select("readingMinutes", "words", "summary").from("articles").all(),
  cms:await content.select("words").from("cms").all(),
}));
`,
            ],
            { cwd: fixture.root },
          );
          expect(JSON.parse(deployed.stdout)).toEqual(expected);
        }
      } finally {
        await fixture.dispose();
      }
    },
  );

  test("reports helper input errors with collection, entry, and computed-field context", async () => {
    const fixture = await projectFixture();
    try {
      await writeFile(
        fixture.config,
        `import {defineCollection} from "content-query";
import {wordCount} from "content-query/computed";
export const collections={posts:defineCollection({source:"./content/posts",computed:{words:wordCount({from:()=>42})}})};
`,
      );
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
const {buildContent}=await import("content-query/build");
try {await buildContent({backend:"in-memory"});} catch(error) {console.log(JSON.stringify(error.diagnostics));}
`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual([
        expect.objectContaining({
          code: "validation-error",
          collection: "posts",
          id: "getting-started",
          path: ["words"],
        }),
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  test("recomputes helpers after watched body and selected metadata edits", async () => {
    const fixture = await projectFixture(true);
    let session: ContentSession | undefined;
    try {
      await writeFile(fixture.postPath, "---\ntitle: First title\n---\nInitial body\n");
      await writeFile(
        fixture.config,
        `import {defineCollection} from "content-query";
import {wordCount,excerpt} from "content-query/computed";
import {glob} from "content-query/loaders";
import { schema } from "content-query/schema";
export const collections={posts:defineCollection({loader:glob({base:"./content/posts",pattern:"*.md",deferRender:true}),schema:schema.object({title:schema.string()}),computed:{words:wordCount(),summary:excerpt<{title:string}>({from:({data})=>data.title,format:"text"})}})};
`,
      );
      session = await buildAtRoot(fixture.root, { watch: true, backend: "in-memory" });
      expect(sessionInternals(session).state.revision?.collections.posts?.records[0]).toMatchObject(
        { words: 2, summary: "First title" },
      );
      await writeFile(fixture.postPath, "---\ntitle: Updated title\n---\nA changed longer body\n");
      await vi.waitFor(() => {
        expect(
          sessionInternals(session!).state.revision?.collections.posts?.records[0],
        ).toMatchObject({ words: 4, summary: "Updated title" });
      });
    } finally {
      await session?.dispose();
      await fixture.dispose();
    }
  });

  test("keeps the helper entry server-only and independent of the syntax highlighter", async () => {
    const fixture = await projectFixture();
    try {
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
import {registerHooks} from "node:module";
registerHooks({resolve(specifier,context,next){
  if (specifier === "shiki" || specifier.startsWith("@shikijs/")) {throw new Error("Unexpected highlighter import");}
  return next(specifier,context);
}});
const {wordCount}=await import("content-query/computed");
console.log(typeof wordCount);
`,
        ],
        { cwd: fixture.root },
      );
      expect(stdout.trim()).toBe("function");
      await expect(
        execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'globalThis.window={};await import("content-query/computed");',
          ],
          { cwd: fixture.root },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("server-only") });
      expect(await readFile(path.join(packageRoot, "dist/computed.d.mts"), "utf8")).toContain(
        "StandardSchemaV1",
      );
    } finally {
      await fixture.dispose();
    }
  });
});
