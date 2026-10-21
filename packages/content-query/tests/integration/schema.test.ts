import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { buildAtRoot } from "../../src/preparation/build.ts";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

/** Checks the real package declarations and generated query types in an isolated consumer. */
async function typecheckConsumer(root: string): Promise<void> {
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
      "--allowImportingTsExtensions",
      "consumer.ts",
    ],
    { cwd: root },
  );
}

describe("bundled schema consumer", () => {
  test("builds and typechecks without a direct Zod dependency, then deploys without validation", async () => {
    const fixture = await projectFixture();
    try {
      expect(await readdir(path.join(fixture.root, "node_modules"))).toEqual(["content-query"]);
      await writeFile(
        fixture.config,
        `import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
export const postSchema = schema.object({
  title: schema.string().min(1).transform(value => value.toUpperCase()),
  date: schema.coerce.date(),
  draft: schema.boolean().default(false),
  subtitle: schema.string().optional(),
});
export const collections = { posts: defineCollection({
  source: "./content/posts",
  schema: postSchema,
  computed: { titleLength: { schema: schema.number().int(), resolve: ({data}) => data.title.length } },
}) };`,
      );
      await (await buildAtRoot(fixture.root, {})).dispose();
      await writeFile(
        path.join(fixture.root, "consumer.ts"),
        `import { schema } from "content-query/schema";
import { content } from "./.content-query/server.js";
import { postSchema } from "./content-query.config.ts";
const input: schema.input<typeof postSchema> = { title: "Post", date: "2026-01-01" };
const output: schema.output<typeof postSchema> = { title: "POST", date: new Date(), draft: false };
const inferred: schema.infer<typeof postSchema> = output;
const posts: Promise<{title:string;date:Date;draft:boolean;subtitle:string|undefined;titleLength:number}[]> =
  content.select("title", "date", "draft", "subtitle", "titleLength").from("posts").all();
// @ts-expect-error Outputs include the defaulted boolean.
const incomplete: schema.output<typeof postSchema> = { title: "Post", date: new Date() };
// @ts-expect-error Builder exports exclude provider-level parsing utilities.
void schema.parse;
// @ts-expect-error Generated queries retain their inferred field types.
content.select("missing").from("posts");
void [input, inferred, posts, incomplete];`,
      );
      await typecheckConsumer(fixture.root);

      expect(
        await readFile(path.join(fixture.root, ".content-query/server.js"), "utf8"),
      ).not.toMatch(/content-query\/schema|content-query\.config|zod/);
      await rm(fixture.config);
      await rm(path.join(fixture.root, "content"), { recursive: true });
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "content-query/schema" || specifier === "zod" || specifier.startsWith("zod/")) {
    throw new Error("Validator imported at runtime: " + specifier);
  }
  return next(specifier, context);
} });
const { content } = await import("./.content-query/server.js");
console.log(JSON.stringify(await content.select("title", "date", "draft", "titleLength").from("posts").all()));`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual([
        {
          title: "GETTING STARTED",
          date: "2026-01-01T00:00:00.000Z",
          draft: false,
          titleLength: 15,
        },
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  test.each(["collection", "computed"] as const)(
    "retains contextual %s diagnostics",
    async (kind) => {
      const fixture = await projectFixture();
      try {
        await writeFile(
          fixture.config,
          `import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
export const collections = { posts: defineCollection({
  source: "./content/posts", schema: schema.object({title:schema.string()}),
  computed: { titleLength: {schema:schema.number(),resolve:()=>"invalid"} },
}) };`,
        );
        if (kind === "collection") {
          await writeFile(fixture.postPath, "---\ntitle: false\n---\n");
        }
        await expect(buildAtRoot(fixture.root, {})).rejects.toMatchObject({
          code: "validation-error",
          collection: "posts",
          id: "getting-started",
          path: [kind === "collection" ? "title" : "titleLength"],
          issues: [expect.objectContaining({ message: expect.any(String) })],
        });
      } finally {
        await fixture.dispose();
      }
    },
  );
});

describe("other Standard Schema providers", () => {
  test.each(["sync", "async"] as const)(
    "supports %s collection and computed validators",
    async (mode) => {
      const fixture = await projectFixture();
      const asynchronous = mode === "async" ? "async " : "";
      try {
        await writeFile(
          fixture.config,
          `import { defineCollection } from "content-query";
export const metadataSchema = { "~standard": {
  version: 1 as const, vendor: "fixture-validator",
  types: undefined as {input:unknown;output:{title:string}} | undefined,
  ${asynchronous}validate(value: unknown) {
    const title = (value as {title?:unknown} | null)?.title;
    if (typeof title !== "string") {
      return {issues:[{message:"A title is required.",path:[{key:"title"}]}]};
    }
    return {value:{title:title.toUpperCase()}};
  },
} };
export const lengthSchema = { "~standard": {
  version: 1 as const, vendor: "fixture-validator",
  types: undefined as {input:string;output:number} | undefined,
  ${asynchronous}validate(value: unknown) {
    return typeof value === "string" ? {value:value.length} : {issues:[{message:"Expected text."}]};
  },
} };
export const collections = { posts: defineCollection({
  source: "./content/posts", schema: metadataSchema,
  computed: {titleLength:{schema:lengthSchema,resolve:({data})=>data.title}},
}) };`,
        );
        const expected = [{ title: "GETTING STARTED", titleLength: 15 }];
        for (const backend of ["in-memory", "generated"] as const) {
          const session = await buildAtRoot(fixture.root, { backend });
          try {
            expect(
              await session.content
                .select("title", "titleLength")
                .from("posts" as never)
                .all(),
            ).toEqual(expected);
          } finally {
            await session.dispose();
          }
        }
        await writeFile(
          path.join(fixture.root, "consumer.ts"),
          `import type { schema } from "content-query/schema";
import type { metadataSchema, lengthSchema } from "./content-query.config.ts";
import { content } from "./.content-query/server.js";
const metadata: schema.infer<typeof metadataSchema> = {title:"Post"};
const input: schema.input<typeof lengthSchema> = "Post";
const output: schema.output<typeof lengthSchema> = 4;
const posts: Promise<{title:string;titleLength:number}[]> = content.select("title", "titleLength").from("posts").all();
// @ts-expect-error Provider-independent inference retains the transformed output type.
const invalid: schema.infer<typeof lengthSchema> = "4";
void [metadata, input, output, posts, invalid];`,
        );
        await typecheckConsumer(fixture.root);

        await writeFile(fixture.postPath, "---\ntitle: false\n---\n");
        await expect(buildAtRoot(fixture.root, {})).rejects.toMatchObject({
          code: "validation-error",
          collection: "posts",
          id: "getting-started",
          path: ["title"],
          issues: [{ message: "A title is required.", path: [{ key: "title" }] }],
        });
      } finally {
        await fixture.dispose();
      }
    },
  );
});
