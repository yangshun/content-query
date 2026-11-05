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

Your server imports each prepared collection it queries from that collection's own entry, so it loads only those collections. Queries return selected metadata, and load an item's retained body or rendered output only when they request it as a payload. Production does not need the original content files or collection configuration.

## Development updates

The Vite plugin watches sources and publishes complete revisions. Invalid edits surface errors until corrected. The host framework refreshes its page data after updates; [Vite integration](/docs/integrations/vite#development-updates) explains how to connect that refresh.

The [Next.js adapter](/docs/integrations/next) watches sources and collection configuration, then publishes generated modules that Next.js observes through HMR. It supports Turbopack and Webpack. Content errors appear in Next.js's development overlay and recover after a valid edit.

Standalone builds produce a snapshot. Use `content-query build --watch` or `buildContent({ watch: true })` to keep it current during development. The host owns refreshing application data and stopping the watch session. See [standalone usage](/docs/integrations/standalone).
