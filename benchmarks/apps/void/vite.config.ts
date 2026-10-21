import { voidReact } from "@void/react/plugin";
import { contentQuery } from "content-query/vite";
import { defineConfig, type Plugin } from "vite-plus";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [
    // Linked framework packages resolve Vite's types from their own workspace.
    voidPlugin() as unknown as Plugin[],
    voidReact() as unknown as Plugin[],
    contentQuery({
      backend: process.env.CONTENT_QUERY_BENCH_BACKEND === "generated" ? "generated" : "in-memory",
    }) as unknown as Plugin,
  ],
});
