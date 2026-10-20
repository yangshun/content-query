import { defineConfig } from "void/config";

export default defineConfig({
  output: "static",
  cloudflare: { name: "content-query-benchmark", compatibility_date: "2026-10-19" },
  head: { htmlAttrs: { lang: "en" }, titleTemplate: "%s | ContentQuery benchmark" },
});
