import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      loaders: "src/loaders.ts",
      query: "src/query.ts",
      build: "src/build.ts",
      runtime: "src/runtime.ts",
      internal: "src/internal.ts",
      "internal/markdown": "src/runtime/markdown.ts",
      vite: "src/vite.ts",
      next: "src/next.ts",
      cli: "src/cli.ts",
    },
    dts: true,
    exports: { inlinedDependencies: false },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    globalSetup: ["./tests/helpers/global-setup.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: { statements: 90, lines: 90, branches: 85, functions: 90 },
    },
  },
  fmt: {},
});
