import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: {
    include: ["benchmarks/tests/**/*.browser.ts"],
    globalSetup: ["./packages/content-query/tests/helpers/global-setup.ts"],
  },
});
