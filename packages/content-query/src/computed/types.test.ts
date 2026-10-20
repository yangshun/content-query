import { describe, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../index.ts";
import { excerpt, readingTime, wordCount } from "../computed.ts";
import type { QueryData } from "../collection/types.ts";
import type { Loader } from "../loaders.ts";

describe("computed helper inference", () => {
  test("infers helper results alongside custom computed fields", () => {
    const posts = defineCollection({
      source: "./content/posts",
      schema: z.object({ title: z.string() }),
      computed: {
        readingMinutes: readingTime(),
        words: wordCount(),
        summary: excerpt(),
        uppercase: { schema: z.string(), resolve: ({ data }) => data.title.toUpperCase() },
      },
    });
    expectTypeOf<QueryData<typeof posts>["readingMinutes"]>().toEqualTypeOf<number>();
    expectTypeOf<QueryData<typeof posts>["words"]>().toEqualTypeOf<number>();
    expectTypeOf<QueryData<typeof posts>["summary"]>().toEqualTypeOf<string>();
    expectTypeOf<QueryData<typeof posts>["uppercase"]>().toEqualTypeOf<string>();
  });

  test("types custom selectors and preserves inferred query results", () => {
    const cms: Loader<{ summary: string }> = { name: "cms", async load() {} };
    const schema = z.object({ description: z.string(), count: z.number() });
    type Data = z.infer<typeof schema>;
    type Source = { summary: string };
    const collection = defineCollection({
      loader: cms,
      schema,
      computed: {
        summary: excerpt<Data, Source>({
          from: ({ data, source }) => {
            expectTypeOf(data.description).toEqualTypeOf<string>();
            expectTypeOf(source?.summary).toEqualTypeOf<string | undefined>();
            // @ts-expect-error Selectors expose validated metadata, not unknown fields.
            void data.missing;
            // @ts-expect-error Loader source fields remain typed.
            void source?.filePath;
            return data.description;
          },
          format: "text",
        }),
        words: wordCount<Data, Source>({ from: ({ source }) => source?.summary, format: "html" }),
        minutes: readingTime<Data>({ from: async ({ data }) => data.description }),
      },
    });
    expectTypeOf<QueryData<typeof collection>["summary"]>().toEqualTypeOf<string>();
    expectTypeOf<QueryData<typeof collection>["words"]>().toEqualTypeOf<number>();
    expectTypeOf<QueryData<typeof collection>["minutes"]>().toEqualTypeOf<number>();
  });
});
