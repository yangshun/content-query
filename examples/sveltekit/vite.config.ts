import { defineConfig, type Plugin } from "vite-plus";
import { sveltekit } from "@sveltejs/kit/vite";
import { contentQuery } from "content-query/vite";
import adapter from "@sveltejs/adapter-static";

export default defineConfig({
  plugins: [contentQuery() as unknown as Plugin, sveltekit({ adapter: adapter() })],
});
