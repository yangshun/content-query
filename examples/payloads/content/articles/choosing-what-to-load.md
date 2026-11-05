---
title: Choosing what to load
summary: Listing pages need titles, not whole articles.
authorId: ada
publishedAt: 2026-10-01
---

## Lists need metadata

An index page shows a title and a summary for each article. Loading every article's HTML to draw that list wastes time and memory.

## Detail pages need the article

When a reader opens one article, request its rendered output in the same query that loads its title:

```ts
const article = await articles.findFirst({
  where: { id },
  payloads: { _rendered: true },
});
```
