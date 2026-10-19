import { defineConfig, type Plugin } from "vite-plus";
import { reactRouter } from "@react-router/dev/vite";
import { contentQuery } from "content-query/vite";

export default defineConfig({ plugins: [contentQuery() as unknown as Plugin, reactRouter()] });
