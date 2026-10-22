import { reactRouter } from "@react-router/dev/vite";
import { contentQuery } from "content-query/vite";
import { contentQueryMdx } from "@content-query/mdx/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  build: { assetsInlineLimit: 0 },
  plugins: [contentQuery(), contentQueryMdx({ rendering: "both" }), reactRouter()],
});
