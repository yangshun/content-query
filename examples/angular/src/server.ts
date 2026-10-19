import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from "@angular/ssr/node";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGuide, loadHome, loadNavigation } from "./server/content";

const app = express();
const angularApp = new AngularNodeAppEngine();
const browserDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../browser");

app.get("/api/guides", async (_request, response) => {
  response.json(await loadHome());
});
app.get("/api/navigation", async (_request, response) => {
  response.json(await loadNavigation());
});
app.get("/api/guide", async (request, response) => {
  const article = await loadGuide(
    typeof request.query["id"] === "string" ? request.query["id"] : "",
  );
  response.status(article ? 200 : 404).json(article);
});
app.use(express.static(browserDirectory, { maxAge: "1y", index: false, redirect: false }));
app.use((request, response, next) => {
  angularApp
    .handle(request)
    .then((rendered) => {
      if (rendered) {
        return writeResponseToNodeResponse(rendered, response);
      }
      return next();
    })
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const server = app.listen(Number(process.env["PORT"] ?? 4000), () => {
    const address = server.address();
    if (address && typeof address !== "string") {
      console.log(`Angular SSR listening on http://127.0.0.1:${address.port}`);
    }
  });
}

export const reqHandler = createNodeRequestHandler(app);
