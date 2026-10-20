import contentCollections from "@content-collections/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { readFile } from "node:fs/promises";
import path from "node:path";

export default defineConfig({
  appType: "custom",
  plugins: [
    react(),
    contentCollections(),
    {
      name: "benchmark-react-ssr",
      configureServer(server) {
        return () => {
          server.middlewares.use(async (request, response, next) => {
            const pathname = new URL(request.url ?? "/", "http://benchmark.local").pathname;
            if (pathname !== "/" && !/^\/entries\/entry-\d+\/?$/.test(pathname)) {
              next();
              return;
            }
            try {
              const template = await server.transformIndexHtml(
                pathname,
                await readFile(path.join(server.config.root, "index.html"), "utf8"),
              );
              const { render } = (await server.ssrLoadModule("/src/entry-server.tsx")) as {
                render: (pathname: string) => string;
              };
              response.statusCode = 200;
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.end(template.replace("<!--app-html-->", () => render(pathname)));
            } catch (cause) {
              if (cause instanceof Error) {
                server.ssrFixStacktrace(cause);
              }
              next(cause);
            }
          });
        };
      },
    },
  ],
});
