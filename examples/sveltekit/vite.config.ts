import { defineConfig } from "vite-plus";
import { sveltekit } from "@sveltejs/kit/vite";
import { contentQuery } from "content-query/vite";
import adapter from "@sveltejs/adapter-static";

export default defineConfig({
  plugins: [contentQuery(), sveltekit({ adapter: adapter() })],
});
