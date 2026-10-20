import { defineNuxtConfig } from "nuxt/config";
import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  modules: ["@nuxt/content"],
  css: [fileURLToPath(new URL("../../shared/styles.css", import.meta.url))],
  content: { experimental: { sqliteConnector: "native" } },
  nitro: { prerender: { crawlLinks: true, failOnError: true } },
});
