import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { contentQuery } from "content-query/vite";
import { defineConfig, type Plugin } from "vite-plus";

export default defineConfig({
  // Dependency discovery runs before Start strips the server function handlers.
  optimizeDeps: { exclude: ["content-query:server"] },
  plugins: [
    contentQuery({ backend: "in-memory" }) as unknown as Plugin,
    tanstackStart({ prerender: { enabled: true, crawlLinks: true, failOnError: true } }),
    react(),
  ],
});
