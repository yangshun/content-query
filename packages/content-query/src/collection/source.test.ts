import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "./define.ts";
import { collectLoader } from "../../tests/helpers/loader.ts";
import { projectFixture } from "../../tests/helpers/project.ts";
import { prepareAtRoot } from "../preparation/build.ts";

describe("collection source shorthand", () => {
  test("defaults string sources to Markdown and keeps directory-relative IDs", async () => {
    const fixture = await projectFixture();
    try {
      await writeFile(
        fixture.config,
        `import {defineCollection} from "content-query"; import {z} from "zod"; export const collections={posts:defineCollection({source:"./content/posts",schema:z.object({title:z.string()})})};`,
      );
      const session = await prepareAtRoot(fixture.root, { backend: "in-memory" });
      try {
        expect(
          await session.content
            .query("posts" as never)
            .select("title" as never)
            .all(),
        ).toEqual([{ title: "Getting started" }]);
        expect((await session.content.render("posts" as never, "getting-started")).html).toContain(
          "Hello",
        );
      } finally {
        await session.dispose();
      }
    } finally {
      await fixture.dispose();
    }
  });

  for (const [type, filename, text] of [
    ["markdown", "entry.md", "---\ntitle: Example\n---\nBody"],
    ["json", "entry.json", '{"title":"Example"}'],
    ["yaml", "entry.yml", "title: Example"],
    ["toml", "entry.toml", 'title = "Example"'],
  ] as const) {
    test(`loads explicit ${type} sources through the native loader`, async () => {
      const fixture = await projectFixture();
      try {
        const directory = path.join(fixture.root, "typed");
        await mkdir(directory);
        await writeFile(path.join(directory, filename), text);
        const collection = defineCollection({
          source: { type, directory },
          schema: z.object({ title: z.string() }),
        });
        expect(await collectLoader(collection.loader)).toMatchObject([
          { id: "entry", data: { title: "Example" } },
        ]);
      } finally {
        await fixture.dispose();
      }
    });
  }

  test("rejects ambiguous and malformed sources", () => {
    expect(() => defineCollection({ source: "", schema: z.object({}) })).toThrow();
    expect(() =>
      defineCollection({ source: { type: "unknown", directory: "." } } as never),
    ).toThrow();
    expect(() =>
      defineCollection({ source: ".", loader: { name: "fixture", async load() {} } } as never),
    ).toThrow();
  });
});
