---
title: Introduction
description: Typed content collections, queries, and rendering for your application.
section: getting-started
order: 1
---

ContentQuery turns Markdown and structured data into validated content that your application can query and render. Use it with your existing framework through Vite or Next.js, or as a standalone build step.

## Features

- **[Typed collections](/docs/collections-and-schemas).** Validate metadata with Zod or another Standard Schema library, with inferred TypeScript types.
- **[Flexible sources](/docs/sources-and-loaders).** Load Markdown, JSON, YAML, and TOML, or use Astro-compatible and custom content loaders.
- **[Computed fields](/docs/computed-fields).** Derive validated metadata during preparation and query it like any other field.
- **[Typed queries](/docs/querying-content).** Filter, sort, paginate, count, and select fields through fluent or object APIs.
- **[Relationships](/docs/relationships).** Connect collections, validate references, and select related entries in nested queries.
- **[Markdown rendering](/docs/rendering-content).** Get HTML, headings, and syntax highlighting, with article output loaded separately from metadata.
- **[Framework integrations](/docs/integrations/frameworks).** Refresh content during development with [Vite](/docs/integrations/vite) or [Next.js](/docs/integrations/next), or build portable runtime artifacts with the [CLI](/docs/integrations/standalone).

## The basic workflow

1. **Define content.** Choose sources and validate their metadata with a schema.
2. **Query content.** Select fields, filter entries, and load related content.
3. **Render content.** Request a Markdown article's HTML and headings when you need them.

Metadata queries and rendered bodies are separate. A page listing can select titles without loading every article. Your application owns routes, layouts, and public URLs.

## Start here

Follow the [quick start](/docs/quick-start) to build a small content pipeline, or read [how ContentQuery works](/docs/how-it-works) to understand preparation and runtime behavior.
