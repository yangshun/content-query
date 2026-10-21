import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Generator, getConfig } from "@tanstack/router-generator";

const repository = new URL("../", import.meta.url);
const cli = fileURLToPath(new URL("packages/content-query/dist/cli.mjs", repository));

// Generate real consumer declarations without depending on a previous development session.
for (const application of [
  "examples/angular/",
  "examples/next/",
  "examples/react-router/",
  "examples/sveltekit/",
  "examples/tanstack-start/",
  "examples/void/",
  "website/",
  "benchmarks/apps/next/",
  "benchmarks/apps/tanstack-start/",
  "benchmarks/apps/void/",
]) {
  execFileSync(process.execPath, [cli, "build"], {
    cwd: new URL(application, repository),
    stdio: "inherit",
  });
}

for (const [application, arguments_] of [
  ["examples/sveltekit/", ["exec", "svelte-kit", "sync"]],
  ["benchmarks/apps/astro/", ["exec", "astro", "sync"]],
  ["benchmarks/apps/nuxt/", ["exec", "nuxt", "prepare"]],
  ["benchmarks/apps/vite-react/", ["build"]],
]) {
  execFileSync("vp", arguments_, {
    cwd: new URL(application, repository),
    stdio: "inherit",
  });
}

for (const application of ["examples/tanstack-start/", "benchmarks/apps/tanstack-start/"]) {
  const root = fileURLToPath(new URL(application, repository));
  const generator = new Generator({ config: getConfig({}, root), root });
  await generator.run();
}
