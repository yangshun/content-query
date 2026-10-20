# Vite + React + Content Collections benchmark app

The `@content-collections/vite` plugin validates `content/entries/*.md` and transforms each entry with `@content-collections/markdown`. The homepage renders every title and description with a link to `/entries/<id>/`. Each dedicated route renders that entry's compiled HTML.

Vite's SSR API renders development requests. The build script creates the browser bundle and SSR renderer, then uses React's `renderToString()` to write `dist/index.html` and one `dist/entries/<id>/index.html` per item. The build command includes all these steps and produces 10,001 content HTML pages. The browser hydrates that markup. Content Collections' full generated array remains part of the client bundle, including compiled bodies. See [Vite's SSR/SSG guide](https://vite.dev/guide/ssr#pre-rendering-ssg).

Use `vp run build` for this app's custom build script; `vp build` alone runs only Vite's built-in browser build and does not prerender the routes.

Follow the [suite setup](../../README.md#setup) to install dependencies, Chromium, and generate the shared corpus. From the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-vite-react dev
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-vite-react build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-vite-react preview
```

Use the [benchmark runner](../../README.md#run-the-comparison) for controlled cold/warm measurements. Generated content, `.content-collections/`, `.prerender/`, and `dist/` are ignored by Git.
