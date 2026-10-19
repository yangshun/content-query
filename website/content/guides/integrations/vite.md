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

Server modules import `content` from `content-query:server`. Include `.content-query/**/*.d.ts` in `tsconfig.json` for the generated collection types. The plugin rejects direct and transitive client imports of the server runtime.

## Development updates

Vite watches source and configuration changes. Connect the browser-safe `onContentUpdate()` subscription from `content-query:client` to your framework's data refresh:

```ts
import { onContentUpdate } from "content-query:client";

const unsubscribe = onContentUpdate(async () => {
  await refreshPageData();
});
```

`refreshPageData()` stands for your router's refresh function. Register it in your framework's lifecycle hook, and unsubscribe on cleanup. The production subscription is a no-op.

See the [framework guides](/docs/integrations/frameworks) for the server boundaries and refresh methods used by the examples.
