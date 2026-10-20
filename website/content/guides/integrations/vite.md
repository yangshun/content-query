---
title: Vite
description: Prepare content, watch sources, and import the typed server facade.
section: integrations
order: 40
---

Add the ContentQuery plugin alongside your framework's plugins:

```ts
import { contentQuery } from "content-query/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [contentQuery()],
});
```

## Server imports and types

The plugin defaults to the in-memory backend. It writes `.content-query/types.d.ts` for editor types and delivers runtime content through Vite's virtual modules and production bundle. To also publish standalone runtime files for consumers outside Vite, use `contentQuery({ backend: "generated" })`. The standalone CLI and build API still default to generated storage.

Server modules import `content` from `content-query:server`. Include `.content-query/**/*.d.ts` in `tsconfig.json` for the generated collection types. The plugin rejects direct and transitive client imports of the server runtime.

## Development updates

The plugin excludes generated content artifacts from Vite's watcher and preserves your configured ignores. It watches authored sources and configuration separately, so publishing a large collection does not trigger application file events for every generated payload.

Vite watches source and configuration changes. Connect the browser-safe `onContentUpdate()` subscription from `content-query:client` to your framework's data refresh:

```ts
import { onContentUpdate } from "content-query:client";

const unsubscribe = onContentUpdate(async () => {
  await refreshPageData();
});
```

`refreshPageData()` stands for your router's refresh function. Register it in your framework's lifecycle hook, and unsubscribe on cleanup. The production subscription is a no-op.

See the [framework guides](/docs/integrations/frameworks) for the server boundaries and refresh methods used by the examples.

## Production builds

Content preparation runs in server environments. Client compilation still enforces the server import boundary and does not repeat content loading or Markdown compilation.

Before bundling, the plugin packs server payloads into lazy source modules targeting 128 KiB. This also avoids per-item facade modules in hosts that require strict entry signatures. Default metadata queries do not import bodies; rendering one entry can load neighboring payloads in its module. Your output and chunking settings continue to control the final bundle. Standalone generated artifacts remain ordinary per-item ESM modules.
