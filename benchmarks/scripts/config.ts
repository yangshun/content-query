import path from "node:path";
import { fileURLToPath } from "node:url";

export const benchmarkRoot = fileURLToPath(new URL("../", import.meta.url));
export const defaultEntries = 10_000;
export const startupTimeout = 300_000;
export const buildTimeout = 600_000;
export const workload = "full-index-and-prerendered-articles";

export const apps = [
  {
    id: "astro",
    label: "Astro collections",
    cli: "astro",
    output: "Static HTML",
    staticOutput: "dist",
    htmlLayout: "directory",
    packages: ["astro"],
  },
  {
    id: "vite-react",
    label: "Vite + React + Content Collections",
    cli: null,
    output: "Prerendered HTML + React hydration (Vite SSR/SSG)",
    staticOutput: "dist",
    htmlLayout: "directory",
    packages: [
      "react",
      "react-dom",
      "@content-collections/core",
      "@content-collections/vite",
      "@content-collections/markdown",
    ],
  },
  {
    id: "nuxt",
    label: "Nuxt Content",
    cli: "nuxt",
    output: "Prerendered HTML + Nuxt payloads (nuxt generate)",
    staticOutput: ".output/public",
    htmlLayout: "directory",
    packages: ["nuxt", "vue", "@nuxt/content"],
  },
  {
    id: "void",
    label: "Void + ContentQuery",
    cli: null,
    output: "Static HTML + bundled content",
    staticOutput: "dist/client",
    htmlLayout: "flat",
    packages: ["void", "@void/react", "react", "content-query"],
  },
  {
    id: "next",
    label: "Next.js + ContentQuery",
    cli: "next",
    output: "Static HTML + RSC payloads (Next.js export)",
    staticOutput: "out",
    htmlLayout: "directory",
    packages: ["next", "react", "react-dom", "content-query"],
  },
  {
    id: "tanstack-start",
    label: "TanStack Start + ContentQuery",
    cli: null,
    output: "Prerendered HTML + React hydration (TanStack Start)",
    staticOutput: "dist/client",
    htmlLayout: "directory",
    packages: [
      "@tanstack/react-start",
      "@tanstack/react-router",
      "react",
      "react-dom",
      "content-query",
    ],
  },
] as const;

export type App = (typeof apps)[number];
export type Phase = "startup" | "build";
export type Cache = "cold" | "warm";

/** Resolves a benchmark application within either the real suite or an isolated test copy. */
export function appDirectory(root: string, app: App): string {
  return path.join(root, "apps", app.id);
}

/** Runs framework builds, React prerendering, and static-file previews through Vite+. */
export function command(app: App, phase: "dev" | "build" | "preview", port?: number): string[] {
  const arguments_ =
    phase === "preview"
      ? ["exec", "node", "../../shared/preview.ts", "--dir", app.staticOutput]
      : app.id === "vite-react" && phase === "build"
        ? ["run", "--no-cache", "build"]
        : app.cli
          ? ["exec", app.cli, app.id === "nuxt" && phase === "build" ? "generate" : phase]
          : [phase];
  if (app.id === "astro" && phase === "dev") {
    // Astro auto-backgrounds under coding agents; every timed process must remain owned here.
    arguments_.push("--ignore-lock");
  }
  if (port !== undefined) {
    arguments_.push(
      app.id === "next" && phase !== "preview" ? "--hostname" : "--host",
      "127.0.0.1",
      "--port",
      String(port),
    );
    if (!app.cli && phase !== "preview") {
      arguments_.push("--strictPort");
    }
  }
  return arguments_;
}

export const cacheDirectories = [
  ".astro",
  ".nuxt",
  ".next",
  ".output",
  ".data",
  ".content-collections",
  ".prerender",
  ".content-query",
  ".tanstack",
  "src/routeTree.gen.ts",
  ".void",
  "void.lock.json",
  ".void-wrangler.jsonc",
  ".wrangler",
  "dist",
  "out",
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "node_modules/.astro",
  "node_modules/.cache",
];
