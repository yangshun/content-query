import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { contentQuery } from "content-query/vite";

export default defineConfig({
  // Server function handlers are stripped after dependency discovery.
  optimizeDeps: { exclude: ["content-query:server"] },
  plugins: [
    contentQuery(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        // /docs is a layout boundary; its article routes are discovered from links.
        filter: ({ path }) => path !== "/docs" && path !== "/docs/",
      },
    }),
    react(),
  ],
});
