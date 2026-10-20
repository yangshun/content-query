import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Creates a real package consumer with package-resolution and TypeScript configuration. */
export async function projectFixture(deferRender = false, retainBody = true) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-consumer-")));
  await mkdir(path.join(root, "node_modules"));
  await symlink(packageRoot, path.join(root, "node_modules/content-query"), "dir");
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await mkdir(path.join(root, "content/posts"), { recursive: true });
  await writeFile(
    path.join(root, "content/authors.json"),
    JSON.stringify([{ id: "ada", name: "Ada" }]),
  );
  const postPath = path.join(root, "content/posts/Getting Started.md");
  await writeFile(
    postPath,
    "---\ntitle: Getting started\nauthorId: ada\ndate: 2026-01-01\n---\n# Hello\n\n## Hello\n\n[Link](/public/page)\n\n```js\nconst answer = 42;\n```\n",
  );
  const config = path.join(root, "content-query.config.ts");
  await writeFile(
    config,
    `import { defineCollection } from "content-query";
import { file, glob } from "content-query/loaders";
import { schema } from "content-query/schema";
const authors = defineCollection({loader: file("./content/authors.json"), schema: schema.object({name:schema.string()})});
const posts = defineCollection({loader: glob({pattern:"**/*.md",base:"./content/posts",deferRender:${deferRender},retainBody:${retainBody}}),schema:schema.object({title:schema.string(),authorId:schema.string(),date:schema.coerce.date()}),computed:{upper:{schema:schema.string(),resolve:({data})=>data.title.toUpperCase()}},relationships:{author:{collection:"authors",type:"one",from:"authorId",to:"id",referenceSide:"from"}}});
export const collections = {authors,posts};\n`,
  );
  return {
    root,
    config,
    postPath,
    async dispose() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
