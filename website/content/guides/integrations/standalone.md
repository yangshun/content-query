---
title: Standalone usage
description: Build portable content without a Vite integration.
section: integrations
order: 43
---

Use the CLI during your application's build, then import the generated `.content-query/server.js` entry from server code. The [quick start](/docs/quick-start) demonstrates this path.

## Build API

Applications can also build content directly:

```ts
import { buildContent } from "content-query/build";
import type { collections } from "./content-query.config";

const session = await buildContent<typeof collections>({
  backend: "in-memory",
});

try {
  const posts = await session.content.query("posts").select("id", "title").all();
} finally {
  await session.dispose();
}
```

The in-memory backend writes no runtime content artifacts. Use the generated backend when the deployment should consume prepared ESM files.

## Watching and deployment

Content builds are one-shot by default. Set `watch: true` for a managed watch session, and dispose it when the host shuts down. Other bundlers must enforce their own server-only import boundary.

A generated watch session removes obsolete collection modules from previous runs after its first successful content build. Invalid startup content delays cleanup until corrected. Later updates retain revisions for that session; starting a new session after previous consumers stop reclaims older files. One-shot builds also remove obsolete collection modules. Application-owned files in the output directory are preserved.

See the [CLI reference](/docs/reference/cli) for build and watch commands.
