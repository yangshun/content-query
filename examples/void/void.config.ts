import { defineConfig } from "void/config";

export default defineConfig({
  output: "static",
  cloudflare: {
    name: "content-query-void",
  },
  head: {
    titleTemplate: "%s | ContentQuery x Void",
    htmlAttrs: { lang: "en" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
});
