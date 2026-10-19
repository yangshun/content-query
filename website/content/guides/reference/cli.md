---
title: CLI
description: Prepare a content snapshot or keep sources watched during development.
section: reference
order: 54
---

## Commands

```sh
npx content-query prepare
npx content-query prepare --watch
```

## Options

| Flag                    | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `--config <file>`       | Use an exact configuration file               |
| `--backend <name>`      | `generated` or `in-memory`                    |
| `--out-dir <directory>` | Change generated output location              |
| `--watch`               | Keep the process subscribed to source changes |

The default backend is `generated`, with output in `.content-query/`. Unknown or repeated flags fail. Stop a watch process when its host shuts down.

Run preparation before your application build. See [standalone usage](/docs/integrations/standalone) for the equivalent JavaScript API.
