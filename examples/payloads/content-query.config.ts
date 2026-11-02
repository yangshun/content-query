import { defineCollection, type Loader } from "content-query";
import { file } from "content-query/loaders";
import { schema } from "content-query/schema";

/** Markdown articles offer the built-in `body` and `rendered` payloads. */
const articles = defineCollection({
  source: "./content/articles",
  schema: schema.object({
    title: schema.string(),
    summary: schema.string(),
    authorId: schema.string(),
    publishedAt: schema.coerce.date(),
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
});

/** `file()` entries are data records, so authors offer no payloads of their own. */
const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: schema.object({ name: schema.string(), bio: schema.string() }),
  relationships: {
    articles: {
      collection: "articles",
      type: "many",
      from: "id",
      to: "authorId",
      referenceSide: "to",
    },
  },
});

/** A custom loader can supply finished HTML, as a CMS would, without a Markdown body. */
const announcementLoader: Loader = {
  name: "announcements",
  async load(context) {
    const id = "launch";
    const data = await context.parseData({ id, data: { title: "The field notes are live" } });
    context.store.clear();
    context.store.set({
      id,
      data,
      rendered: {
        html: '<p>New notes arrive every month. <a href="/articles/choosing-what-to-load.html">Start with the first one</a>.</p>',
      },
    });
  },
};
const announcements = defineCollection({
  loader: announcementLoader,
  schema: schema.object({ title: schema.string() }),
});

export const collections = { articles, authors, announcements };
