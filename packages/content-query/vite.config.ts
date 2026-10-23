import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      computed: "src/computed.ts",
      loaders: "src/loaders.ts",
      query: "src/query.ts",
      build: "src/build.ts",
      runtime: "src/runtime.ts",
      schema: "src/schema.ts",
      internal: "src/internal.ts",
      "internal/markdown": "src/runtime/markdown.ts",
      vite: "src/vite.ts",
      next: "src/next.ts",
      cli: "src/cli.ts",
    },
    dts: true,
    // Keep Vite+ as the development toolchain without requiring it in consumer declarations.
    outputOptions: {
      paths: { "vite-plus": "vite" },
    },
    deps: {
      neverBundle: ["vite-plus"],
      // Keep portable runtime modules usable as ESM without host-side CommonJS conversion.
      alwaysBundle: ["devalue", "fflate", "github-slugger", "markdown-exit"],
    },
    exports: {
      devExports: true,
      inlinedDependencies: false,
      /** Keeps only local Vite types on the toolchain; all runtime and published exports stay built. */
      customExports(exports, { isPublish }) {
        if (!isPublish) {
          for (const name of Object.keys(exports)) {
            if (name === "./package.json") {
              continue;
            }
            const runtime = `./dist/${name === "." ? "index" : name.slice(2)}.mjs`;
            exports[name] =
              name === "./vite" ? { types: "./src/vite.ts", default: runtime } : runtime;
          }
        }
        return exports;
      },
    },
  },
  lint: { options: { typeAware: true, typeCheck: false } },
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
