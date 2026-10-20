import { voidReact } from "@void/react/plugin";
import { contentQuery } from "content-query/vite";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [
    voidPlugin(),
    voidReact(),
    contentQuery({
      backend: process.env.CONTENT_QUERY_BENCH_BACKEND === "generated" ? "generated" : "in-memory",
    }),
  ],
});
