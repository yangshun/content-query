export const featureExampleIds = [
  "source-to-data",
  "query-syntax",
  "typed-queries",
  "relationships",
  "flexible-sources",
  "typed-collections",
  "computed-fields",
  "markdown-rendering",
  "workflows",
] as const;

export type FeatureExampleId = (typeof featureExampleIds)[number];

export const sourceToDataExample = {
  filename: "hello-world.md",
  source: "---\ntitle: Hello, world\ndraft: false\n---\n\nContent starts here.",
  schema: `export const collections = {
  posts: defineCollection({
    source: "./content/posts",
    schema: schema.object({
      title: schema.string(),
      draft: schema.boolean(),
    }),
  }),
};`,
  query: `const posts = await content
  .query("posts")
  .select("title", "draft")
  .all();`,
  data: [{ title: "Hello, world", draft: false }],
} as const;

export const exampleAuthors = [
  { id: "ada", name: "Ada Lovelace" },
  { id: "grace", name: "Grace Hopper" },
];

export const examplePosts = [
  { id: "hello-world", title: "Hello, world", draft: false, authorId: "ada" },
  { id: "whats-next", title: "What's next", draft: true, authorId: "grace" },
  { id: "working-with-content", title: "Working with content", draft: false, authorId: "ada" },
  { id: "writing-with-markdown", title: "Writing with Markdown", draft: false, authorId: "grace" },
];

export type QueryExampleOptions = {
  excludeDrafts: boolean;
  sort: "id-asc" | "title-asc" | "title-desc";
  limit: number | null;
  fields: "title" | "title-and-draft";
};

/** Runs the small local preview; integration tests compare it with ContentQuery queries. */
export function queryExamplePosts(options: QueryExampleOptions) {
  let posts = examplePosts.filter((post) => !options.excludeDrafts || !post.draft);
  posts.sort((first, second) => {
    const firstValue = options.sort === "id-asc" ? first.id : first.title;
    const secondValue = options.sort === "id-asc" ? second.id : second.title;
    const order = firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
    return options.sort === "title-desc" ? -order : order;
  });
  if (options.limit !== null) {
    posts = posts.slice(0, options.limit);
  }
  return posts.map((post) =>
    options.fields === "title-and-draft"
      ? { title: post.title, draft: post.draft }
      : { title: post.title },
  );
}

/** Shows equivalent fluent or Prisma-style code for the current preview controls. */
export function queryExampleCode(
  options: QueryExampleOptions,
  syntax: "fluent" | "prisma-style" = "fluent",
) {
  if (syntax === "prisma-style") {
    return [
      'const posts = await content.findMany("posts", {',
      ...(options.excludeDrafts ? ["  where: { draft: false },"] : []),
      options.fields === "title-and-draft"
        ? "  select: { title: true, draft: true },"
        : "  select: { title: true },",
      ...(options.sort === "id-asc"
        ? []
        : [`  orderBy: [{ title: "${options.sort === "title-desc" ? "desc" : "asc"}" }],`]),
      ...(options.limit === null ? [] : [`  limit: ${options.limit},`]),
      "});",
    ].join("\n");
  }
  const lines = [
    "const posts = await content",
    '  .query("posts")',
    ...(options.excludeDrafts ? ["  .where((fields) => eq(fields.draft, false))"] : []),
    options.fields === "title-and-draft" ? '  .select("title", "draft")' : '  .select("title")',
    ...(options.sort === "id-asc"
      ? []
      : [options.sort === "title-desc" ? '  .orderBy("title", "desc")' : '  .orderBy("title")']),
    ...(options.limit === null ? [] : [`  .limit(${options.limit})`]),
    "  .all();",
  ];
  return lines.join("\n");
}

/** Formats expected query result types for checks against generated declarations. */
export function queryExampleType(options: QueryExampleOptions) {
  return [
    "{",
    "  title: string;",
    ...(options.fields === "title-and-draft" ? ["  draft: boolean;"] : []),
    "}[]",
  ].join("\n");
}

export const collectionExampleCode = `defineCollection({
  source: "./content/posts",
  schema: schema.object({
    title: schema.string(),
    draft: schema.boolean(),
    authorId: schema.string(),
  }),
});`;

export const sourceExamples = [
  {
    format: "markdown",
    label: "Markdown",
    filename: "hello-world.md",
    code: "---\ntitle: Hello, world\ndraft: false\nauthorId: ada\n---\n\nContent starts here.",
  },
  {
    format: "json",
    label: "JSON",
    filename: "hello-world.json",
    code: '{\n  "title": "Hello, world",\n  "draft": false,\n  "authorId": "ada"\n}',
  },
  {
    format: "yaml",
    label: "YAML",
    filename: "hello-world.yaml",
    code: 'title: "Hello, world"\ndraft: false\nauthorId: ada',
  },
  {
    format: "toml",
    label: "TOML",
    filename: "hello-world.toml",
    code: 'title = "Hello, world"\ndraft = false\nauthorId = "ada"',
  },
] as const;

export const computedExampleImports =
  'import { excerpt, readingTime, wordCount } from "content-query/computed";';

export const computedExampleCode = `computed: {
  readingMinutes: readingTime(),
  wordCount: wordCount(),
  excerpt: excerpt({ maxLength: 160 }),
}`;

export const relationshipExampleCode = `relationships: {
  author: {
    collection: "authors",
    type: "one",
    from: "authorId",
    to: "id",
    referenceSide: "from",
  },
}`;

export const relationshipQueryCode = `const posts = await content
  .query("posts")
  .where((fields) => eq(fields.authorId, "ada"))
  .select("title")
  .with("author", (author) => author.select("name"))
  .all();`;

export const markdownExample = `## Hello, world

Content starts here.

\`\`\`ts
const greeting = "Hello, world";
\`\`\``;
