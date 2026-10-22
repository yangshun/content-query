import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      compiler: "src/compiler.ts",
      vite: "src/vite.ts",
      assets: "src/assets.ts",
      client: "src/client.ts",
      react: "src/react.ts",
      "react/server": "src/react/server.ts",
      "react/client": "src/react/client.ts",
    },
    dts: true,
    deps: { neverBundle: ["vite-plus"], alwaysBundle: ["devalue"], onlyBundle: false },
    outputOptions: {
      paths: { "vite-plus": "vite" },
    },
    exports: {
      devExports: true,
      customExports(exports, { isPublish }) {
        if (!isPublish) {
          exports["./vite"] = { types: "./src/vite.ts", default: "./dist/vite.mjs" };
        }
        return exports;
      },
    },
  },
});
