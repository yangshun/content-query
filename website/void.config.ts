import { defineConfig } from "void/config";

export default defineConfig({
  output: "static",
  cloudflare: {
    name: "content-query",
  },
  head: {
    titleTemplate: "%s | ContentQuery",
    htmlAttrs: { lang: "en-US", "data-theme": "dark" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
});
