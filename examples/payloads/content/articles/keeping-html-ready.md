---
title: Keeping HTML ready
summary: Compile Markdown once during the build and serve the result.
authorId: ada
publishedAt: 2026-10-15
---

## Compile during the build

Production builds compile Markdown eagerly. Each article's HTML is stored on its own, so a page loads only the article it shows.

## Load it when asked

A query that requests no payloads never touches article HTML. Requesting `rendered` loads it after filtering and pagination.
