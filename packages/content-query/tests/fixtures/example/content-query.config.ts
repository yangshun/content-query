// content-query.config.ts — development/build preparation only.
import { schema } from "content-query/schema";
import { defineCollection } from "content-query";
import { file, glob } from "content-query/loaders";

const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: schema.object({
    name: schema.string().min(1),
    featuredPostIds: schema.array(schema.string()).default([]),
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
  schema: schema.object({
    title: schema.string().min(1),
    subtitle: schema.string().nullable().optional(),
    locale: schema.string(),
    authorId: schema.string(),
    publishedAt: schema.coerce.date(),
    draft: schema.boolean().default(false),
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
      schema: schema.string(),
      resolve: ({ id }) => id,
    },
  },
});

export const collections = { authors, posts };
