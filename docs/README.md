# ContentQuery documentation

- [Package API and usage](../packages/content-query/README.md)
- [Features](./FEATURES.md)
- [Design and contracts](./PLAN.md)
- [Library comparisons](./COMPARISONS.md)
- [Planned work](./TODO.md)
- [Framework examples](../examples/README.md)
- [Repository history and extraction](./HISTORY.md)

The published package retains its consumer-facing README in `packages/content-query/`. Project-wide design documents live here.

Bundled builders from `content-query/schema` are implemented. The [collections and schemas guide](../website/content/guides/collections-and-schemas.md) covers the selected builders, provider-independent input/output inference, and support for other Standard Schema V1 validators.

The [computed fields guide](../website/content/guides/computed-fields.md) covers reusable reading time, word count, and excerpt helpers from `content-query/computed`, including typed selectors for structured text and HTML.

The [querying guide](../website/content/guides/querying-content.md) covers SQL-ordered fluent queries and collection-scoped relational queries, including default metadata selection, `columns`, `with`, and filters.

`PLAN.md` documents the implemented v1 contracts and living example. `TODO.md` starts with an index grouped by area, followed by a flat list of H3 sections for outstanding tasks and future design notes. Completed capabilities are listed in `FEATURES.md`.
