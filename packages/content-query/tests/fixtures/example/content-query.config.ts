// content-query.config.ts — development/build preparation only.
import { z } from "zod";
import { defineCollection } from "content-query";
import { file, glob } from "content-query/loaders";

const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: z.object({
    name: z.string().min(1),
    featuredPostIds: z.array(z.string()).default([]),
  }),
  relationships: {
    posts: {
      collection: "posts",
      type: "many",
      from: "id",
      to: "authorId",
      referenceSide: "to",
    },
    featuredPosts: {
      collection: "posts",
      type: "many",
      from: "featuredPostIds",
      to: "id",
      referenceSide: "from",
    },
  },
});

const posts = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./content/posts",
    retainBody: true, // Default: retain publicly accessible raw text.
    deferRender: false, // Default: eager compilation for production SSR.
  }),
  schema: z.object({
    title: z.string().min(1),
    subtitle: z.string().nullable().optional(),
    locale: z.string(),
    authorId: z.string(),
    publishedAt: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
  relationships: {
    author: {
      collection: "authors",
      type: "one",
      from: "authorId",
      to: "id",
      referenceSide: "from",
    },
  },
  computed: {
    slug: {
      schema: z.string(),
      resolve: ({ id }) => id,
    },
  },
});

export const collections = { authors, posts };
