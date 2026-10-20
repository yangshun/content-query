import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite-plus";

// Follow Vite's SSR/SSG flow: build browser assets, build the renderer, then render every route.
await build();
const result = await build({
  build: { ssr: "src/entry-server.tsx", outDir: ".prerender", emptyOutDir: true },
});
const outputs = Array.isArray(result) ? result : [result];
const entry = outputs
  .flatMap((output) => ("output" in output ? output.output : []))
  .find((output) => output.type === "chunk" && output.isEntry);
if (!entry) {
  throw new Error("The SSR build did not emit its renderer.");
}
const { render, prerenderPaths } = (await import(
  pathToFileURL(path.resolve(".prerender", entry.fileName)).href
)) as { render: (pathname: string) => string; prerenderPaths: string[] };
const template = await readFile("dist/index.html", "utf8");
if (!template.includes("<!--app-html-->")) {
  throw new Error("The browser build lost its server-rendering placeholder.");
}
for (const pathname of prerenderPaths) {
  const directory = path.join("dist", pathname.slice(1));
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "index.html"),
    template.replace("<!--app-html-->", () => render(pathname)),
  );
}
console.log(`Prerendered ${prerenderPaths.length} HTML pages.`);
