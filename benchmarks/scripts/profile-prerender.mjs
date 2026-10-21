import fs from "node:fs";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { apps, benchmarkRoot } from "./config.ts";
import { verifyStaticOutput } from "./measure.ts";
import { summarizeCpu } from "./summarize-profile.ts";

const { values } = parseArgs({
  options: {
    label: { type: "string", default: "prerender" },
    renderer: { type: "string" },
  },
});
if (!/^[a-z0-9][a-z0-9_-]*$/.test(values.label) || process.versions.node !== "24.21.0") {
  throw new Error("Use Node 24.21.0 and a lowercase, filesystem-safe --label.");
}
const appRoot = path.join(benchmarkRoot, "apps/void");
const packageDir = await fs.promises.realpath(path.join(appRoot, "node_modules/void"));
const distDir = path.join(packageDir, "dist");
const distUrl = pathToFileURL(`${distDir}${path.sep}`).href;
const rendererFile = values.renderer ? path.resolve(values.renderer) : undefined;
const rendererSource = rendererFile ? await readFile(rendererFile, "utf8") : undefined;
const renderer =
  rendererFile && rendererSource !== undefined
    ? {
        file: path.relative(benchmarkRoot, rendererFile),
        sha256: createHash("sha256").update(rendererSource).digest("hex"),
        source: stripTypeScriptTypes(rendererSource),
      }
    : undefined;
const outputRoot = path.join(benchmarkRoot, ".runs/profiles", values.label);
const clientDir = path.join(outputRoot, "apps/void/dist/client");
await mkdir(clientDir, { recursive: true });
if ((await readdir(clientDir)).length) {
  throw new Error("Choose a new label: a prerender replay requires a fresh output directory.");
}
for (const name of await readdir(path.join(appRoot, "dist/client"))) {
  if (["entries", "index.html"].includes(name)) {
    continue;
  }
  await cp(path.join(appRoot, "dist/client", name), path.join(clientDir, name), {
    recursive: true,
    filter: (filename) => !filename.includes("/_void/pages"),
  });
}

let instrumentedModules = 0;
globalThis.__cgDiagnosticModules = (modules) =>
  modules.map((module) => {
    if (typeof module.contents !== "string" || !module.contents.includes("function pageRecords(")) {
      return module;
    }
    const needle = "function pageRecords(records, plan, preserveOrder = false) {";
    if (!module.contents.includes(needle)) {
      throw new Error("The built query executor changed; update the diagnostic hook.");
    }
    instrumentedModules++;
    return {
      ...module,
      contents: module.contents.replace(
        needle,
        `${needle}
const diagnostic = globalThis.__cgQueryDiagnostics ??= { calls: 0, candidates: 0, idQueries: 0, idCandidates: 0 };
diagnostic.calls++;
diagnostic.candidates += records.length;
if (plan.filters.some(expression => expression.kind === "predicate" && expression.field === "id" && expression.operator === "eq")) {
  diagnostic.idQueries++;
  diagnostic.idCandidates += records.length;
}`,
      ),
    };
  });

// Expose the installed runner for diagnostics and enable its local inspector in memory only.
registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith(distUrl) || !url.endsWith(".mjs") || !result.source) {
      return result;
    }
    if (renderer && url.endsWith("/prerender-render.mjs")) {
      return { ...result, source: renderer.source };
    }
    let source =
      typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
    if (!source.includes("async function createCloudflarePrerenderRunner(options)")) {
      return result;
    }
    const needle = "const mf = new Miniflare(convertV4MiniflareOptions(mfOptions));";
    if (!source.includes(needle)) {
      throw new Error("The installed Void runner changed; update the diagnostic hook.");
    }
    source = source.replace(
      needle,
      `mfOptions.inspectorPort = 0;
mfOptions.modules = globalThis.__cgDiagnosticModules(mfOptions.modules);
${needle}
globalThis.__cgDiagnosticMiniflare = mf;`,
    );
    return { ...result, source: `${source}\nexport { createCloudflarePrerenderRunner };\n` };
  },
});

/** Connects to a local worker's Chrome DevTools protocol with bounded RPC calls. */
async function inspectorConnection(url) {
  const socket = new WebSocket(url.replaceAll("#", "%23"));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Inspector connection timed out."));
    }, 10_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
      { once: true },
    );
  });
  let identifier = 0;
  const pending = new Map();
  const contexts = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.executionContextCreated") {
      contexts.push(message.params.context);
    }
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
    }
  });
  return {
    contexts,
    call(method, params = {}) {
      const id = ++identifier;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Inspector RPC timed out: ${method}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

const runnerFile = (await readdir(distDir)).find(
  (name) => name.startsWith("email-cloudflare-") && name.endsWith(".mjs"),
);
const { createCloudflarePrerenderRunner } = await import(
  pathToFileURL(path.join(distDir, runnerFile)).href
);
const { renderPrerenderPaths } = await import(
  pathToFileURL(path.join(distDir, "prerender-render.mjs")).href
);
const phases = {};
const fetches = { html: 0, pageData: 0 };
const io = {};
let recording = false;
for (const name of ["mkdirSync", "writeFileSync"]) {
  const original = fs[name];
  fs[name] = (...arguments_) => {
    const started = performance.now();
    try {
      return original(...arguments_);
    } finally {
      if (recording) {
        const summary = (io[name] ??= { calls: 0, totalMs: 0 });
        summary.calls++;
        summary.totalMs += performance.now() - started;
      }
    }
  };
}
syncBuiltinESMExports();
let runner;
let inspector;
try {
  let started = performance.now();
  runner = await createCloudflarePrerenderRunner({
    root: appRoot,
    workerDir: path.join(appRoot, "dist/ssr"),
    persistDir: path.join(outputRoot, "persist"),
    clientDir,
  });
  const miniflare = globalThis.__cgDiagnosticMiniflare;
  await miniflare.ready;
  phases.bootstrapMs = performance.now() - started;
  started = performance.now();
  const paths = await runner.collectPaths();
  phases.collectPathsMs = performance.now() - started;
  const inspectorUrl = await miniflare.getInspectorURL();
  const endpoint = new URL("/json/list", inspectorUrl);
  endpoint.protocol = "http:";
  const targets = await (await fetch(endpoint)).json();
  for (const target of targets) {
    if (!target.id.startsWith("core:user:") || target.id.includes("#")) {
      continue;
    }
    const connection = await inspectorConnection(target.webSocketDebuggerUrl);
    try {
      await connection.call("Runtime.enable");
      for (const context of connection.contexts) {
        const result = await connection.call("Runtime.evaluate", {
          expression: "typeof globalThis.__cgQueryDiagnostics",
          contextId: context.id,
          returnByValue: true,
        });
        if (result.result.value === "object") {
          inspector = connection;
          inspector.contextId = context.id;
          break;
        }
      }
      if (inspector) {
        break;
      }
    } catch (cause) {
      console.log(`Skipping inspector target ${target.id}: ${cause.message}`);
    }
    connection.close();
  }
  if (!inspector || instrumentedModules !== 1) {
    throw new Error("Could not identify the application's instrumented worker isolate.");
  }
  await inspector.call("Profiler.enable");
  await inspector.call("Profiler.setSamplingInterval", { interval: 1000 });
  await inspector.call("Profiler.start");
  started = performance.now();
  recording = true;
  const result = await renderPrerenderPaths(
    paths,
    clientDir,
    (pathname) => {
      fetches.html++;
      return runner.fetchPath(pathname);
    },
    (pathname) => {
      fetches.pageData++;
      return runner.fetchPageData(pathname);
    },
  );
  recording = false;
  phases.renderMs = performance.now() - started;
  const { profile } = await inspector.call("Profiler.stop");
  const counters = await inspector.call("Runtime.evaluate", {
    expression: "JSON.stringify(globalThis.__cgQueryDiagnostics)",
    contextId: inspector.contextId,
    returnByValue: true,
  });
  inspector.close();
  inspector = undefined;
  await writeFile(path.join(outputRoot, "worker.cpuprofile"), JSON.stringify(profile));
  started = performance.now();
  await runner.close();
  runner = undefined;
  phases.disposeMs = performance.now() - started;
  if (result.failed.length) {
    throw new Error(JSON.stringify(result.failed.slice(0, 5)));
  }
  const manifest = JSON.parse(
    await readFile(path.join(benchmarkRoot, ".fixtures/manifest.json"), "utf8"),
  );
  const pages = await verifyStaticOutput(
    apps.find((app) => app.id === "void"),
    outputRoot,
    manifest.entries,
  );
  const report = {
    label: values.label,
    diagnostic:
      "Prerender replay with worker CPU sampling and query counters; no bundling or CLI startup.",
    ...(renderer ? { renderer: { file: renderer.file, sha256: renderer.sha256 } } : {}),
    node: process.version,
    corpus: manifest,
    phases,
    fetches,
    io,
    query: JSON.parse(counters.result.value),
    pages,
    cpu: summarizeCpu(profile),
    outputRoot: path.relative(benchmarkRoot, outputRoot),
  };
  await writeFile(
    path.join(benchmarkRoot, "results", `profile-${values.label}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      phases,
      fetches,
      io,
      query: report.query,
      pages,
      workerActiveMs: report.cpu.activeMs,
    }),
  );
} finally {
  recording = false;
  inspector?.close();
  await runner?.close();
}
