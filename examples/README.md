# ContentQuery examples

All five examples use the same sample guides and matching local stylesheets. Each example contains its own stylesheet and browser navigation helper where needed; application imports never reach into sibling directories. The local files are hardlinked to the common [`styles.css`](./shared/styles.css) and [`navigation.ts`](./shared/navigation.ts) in this workspace. Shared production test utilities are also included locally through hardlinks. They share a header/footer, numbered home index, two-column docs layout, sticky sidebar, article typography, previous/next links, and a stacked layout below 720px. Branding names the host framework.

The docs sidebar belongs to a persistent layout and has its own metadata query. Article loaders select only the current entry and adjacent entries, then render that article. Content queries stay inline in framework-owned server boundaries; pure presentation remains in components.

| Example                                      | Sidebar data owner                                | Article loading                           |
| -------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| [Void](./void/README.md)                     | Shared middleware feeding `pages/docs/layout.tsx` | Required `.server.ts` page companion      |
| [React Router](./react-router/README.md)     | Parent docs route loader                          | Inline child route loader                 |
| [TanStack Start](./tanstack-start/README.md) | Inline server function in the parent docs route   | Inline server function in the child route |
| [Next.js](./next/README.md)                  | Async docs layout Server Component                | Async page Server Component               |
| [SvelteKit](./sveltekit/README.md)           | `docs/+layout.server.ts`                          | `+page.server.ts`                         |

Void requires companion server files and shared middleware; SvelteKit requires its server route modules. The examples retain these native server/client boundaries. React Router, TanStack Start, and Next.js colocate loading with route UI where supported.

Each example README contains development/build commands. Run `vp check` and `vp test content-query/examples` at the repository root. Production tests build real framework consumers with a nested guide and verify the home index, sidebar, rendered article, active navigation, and adjacent links. Examples remain standalone when copied. Git records hardlinked files as ordinary file contents; a fresh checkout needs no shared sibling files. The parity test verifies that the local copies match the common source.

Internal Markdown links use the host router in the React examples, preserving the docs layout just like sidebar and previous/next links. SvelteKit intercepts internal links natively.
