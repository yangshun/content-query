import { mkdir, rm, writeFile } from "node:fs/promises";
import { content } from "../.content-query/server.js";

const output = new URL("../dist/", import.meta.url);

/** Escapes text for HTML element content and attribute values. */
function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Wraps page content in a minimal document. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escape(title)} | Field notes</title>
<body>
<header><a href="/index.html">Field notes</a></header>
<main>
${body}
</main>
</body>
</html>
`;
}

/** Writes one file below the output directory, creating parent directories as needed. */
async function emit(pathname: string, text: string): Promise<void> {
  const destination = new URL(pathname, output);
  await mkdir(new URL("./", destination), { recursive: true });
  await writeFile(destination, text);
}

await rm(output, { recursive: true, force: true });

// 1. The index needs metadata only. Without `payloads`, no article body or HTML is loaded.
const articles = await content.query.articles.findMany({
  columns: { id: true, title: true, summary: true },
  orderBy: { publishedAt: "desc" },
  with: { author: { columns: { name: true } } },
});

// 2. Fluent queries add payloads with `.withPayload()`. This loads one article's HTML.
const latest = await content
  .from("articles")
  .select("id", "title")
  .orderBy("publishedAt", "desc")
  .withPayload("_rendered")
  .first();

// 3. Custom loaders can supply HTML directly. This entry has no body, so `_body` is undefined.
const announcement = await content.query.announcements.findFirst({
  where: { id: "launch" },
  columns: { title: true },
  payloads: { _rendered: true, _body: true },
});

await emit(
  "index.html",
  page(
    "Articles",
    `${
      announcement
        ? `<aside class="announcement"><h2>${escape(announcement.title)}</h2>${announcement._payloads._rendered.html}</aside>`
        : ""
    }
<h1>Articles</h1>
<ol class="articles">
${articles
  .map(
    (article) =>
      `<li><a href="/articles/${article.id}.html">${escape(article.title)}</a> by ${escape(article.author.name)}: ${escape(article.summary)}</li>`,
  )
  .join("\n")}
</ol>
${
  latest
    ? `<section class="latest"><h2>Latest: <a href="/articles/${latest.id}.html">${escape(latest.title)}</a></h2>${latest._payloads._rendered.html}</section>`
    : ""
}`,
  ),
);

// 4. Each article page loads its metadata, author, and both built-in payloads in one query,
// all from the same content revision.
for (const { id } of articles) {
  const article = await content.query.articles.findFirst({
    where: { id },
    columns: { title: true, publishedAt: true },
    with: { author: { columns: { id: true, name: true } } },
    payloads: { _rendered: true, _body: true },
  });
  if (!article) {
    continue;
  }
  const { _rendered: rendered, _body: body } = article._payloads;
  const contents = rendered.headings
    .map((heading) => `<li><a href="#${heading.slug}">${escape(heading.text)}</a></li>`)
    .join("");
  await emit(
    `articles/${id}.html`,
    page(
      article.title,
      `<article>
<h1>${escape(article.title)}</h1>
<p class="byline">By <a href="/authors/${article.author.id}.html">${escape(article.author.name)}</a> on ${article.publishedAt.toISOString().slice(0, 10)}. <a href="/articles/${id}.md">Markdown source</a></p>
<nav class="contents"><ol>${contents}</ol></nav>
${rendered.html}
</article>`,
    ),
  );
  if (body !== undefined) {
    await emit(`articles/${id}.md`, body);
  }
}

// 5. Payloads also work inside relationship scopes. Authors come from `file()` and have no
// payloads of their own, but their related articles do. Here only each author's newest
// article loads its HTML.
const authors = await content.query.authors.findMany({
  columns: { id: true, name: true, bio: true },
  with: {
    articles: {
      columns: { id: true, title: true },
      orderBy: { publishedAt: "desc" },
      limit: 1,
      payloads: { _rendered: true },
    },
  },
});

for (const author of authors) {
  const [newest] = author.articles;
  await emit(
    `authors/${author.id}.html`,
    page(
      author.name,
      `<h1>${escape(author.name)}</h1>
<p>${escape(author.bio)}</p>
${
  newest
    ? `<section class="newest"><h2>Newest: <a href="/articles/${newest.id}.html">${escape(newest.title)}</a></h2>${newest._payloads._rendered.html}</section>`
    : ""
}`,
    ),
  );
}

console.log(`Wrote ${articles.length} articles and ${authors.length} authors to dist/.`);
