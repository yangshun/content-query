import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globalSetup: ["./packages/content-query/tests/helpers/global-setup.ts"],
    coverage: {
      include: ["packages/content-query/src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: { statements: 90, lines: 90, branches: 85, functions: 90 },
    },
  },
  staged: {
    "*": ["vp check --fix", () => "vp run typecheck"],
  },
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/coverage/**",
      "**/.content-query/**",
      "**/.void/**",
      "**/.wrangler/**",
      "**/.astro/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/.data/**",
      "**/.content-collections/**",
      "**/.prerender/**",
      "**/.tanstack/**",
      "benchmarks/.fixtures/**",
      "benchmarks/.runs/**",
      "benchmarks/apps/*/content/**",
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: false,
    },
  },
});
