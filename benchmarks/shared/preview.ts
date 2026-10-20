import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4321" },
  },
});
if (!values.dir) {
  throw new Error("Pass --dir with the built static output directory.");
}
const root = path.resolve(values.dir);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Preview only files emitted by the build, with both directory and flat HTML layouts.
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://preview.local").pathname);
  const requested = path.resolve(root, `.${pathname}`);
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  for (const filename of [requested, `${requested}.html`, path.join(requested, "index.html")]) {
    try {
      if (!(await stat(filename)).isFile()) {
        continue;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(filename)] ?? "application/octet-stream",
      });
      createReadStream(filename).pipe(response);
      return;
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") {
        response.writeHead(500).end();
        return;
      }
    }
  }
  response.writeHead(404).end("Not found");
});
server.listen(Number(values.port), values.host, () => {
  console.log(`Static preview: http://${values.host}:${values.port}`);
});
