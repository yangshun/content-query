---
title: CLI
description: Build a content snapshot or keep sources watched during development.
section: reference
order: 54
---

## Commands

```sh
npx content-query build
npx content-query build --watch
npx content-query --help
npx content-query build --help
npx content-query --version
```

## Options

| Flag                        | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `-c, --config <file>`       | Use an exact configuration file               |
| `--backend <name>`          | `generated` or `in-memory`                    |
| `-o, --out-dir <directory>` | Change generated output location              |
| `-w, --watch`               | Keep the process subscribed to source changes |
| `-h, --help`                | Show general or command-specific help         |
| `-v, --version`             | Show the ContentQuery version                 |

Value options accept both `--option value` and `--option=value`. Help and version requests do not load collection configuration or build content.

The default backend is `generated`, with output in `.content-query/`. Unknown options, repeated build options, missing values, invalid backends, and extra positional arguments fail. Stop a watch process when its host shuts down.

Run the content build before your application build. See [standalone usage](/docs/integrations/standalone) for the equivalent JavaScript API.
