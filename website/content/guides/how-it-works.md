---
title: How ContentQuery works
description: Understand the boundary between source preparation and deployed content.
section: getting-started
order: 3
---

ContentQuery has two phases: preparation and runtime consumption.

## Preparation

During development or a build, ContentQuery loads sources, validates metadata, resolves computed fields, and checks relationships. The generated backend writes portable ESM indexes and separate item payloads.

## Runtime

Your server imports the prepared runtime. Queries return selected metadata; `readBody()` and `render()` explicitly load an item's retained body or rendered output. Production does not need the original content files or collection configuration.

## Development updates

The Vite plugin watches sources and publishes complete revisions. Invalid edits surface errors until corrected. The host framework refreshes its page data after updates; [Vite integration](/docs/integrations/vite#development-updates) explains how to connect that refresh.

Standalone builds prepare a snapshot. Run preparation again when you want to publish changed content.
