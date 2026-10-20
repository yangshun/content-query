import { Session } from "node:inspector";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import promises from "node:fs/promises";
import path from "node:path";
import { threadId } from "node:worker_threads";
import ts from "typescript";

if (!process.argv.includes("preview")) {
  const directory = process.env.CONTENT_QUERY_PROFILE_DIRECTORY;
  const started = performance.now();
  const spans = {};
  const io = {};
  const events = [];
  const watchEvents = {};
  let watchedServer;
  globalThis.__cgProfileServer = (server) => {
    if (watchedServer === server) {
      return;
    }
    watchedServer = server;
    server.watcher.on("all", (event, filename) => {
      const group = filename.includes("/.content-query/")
        ? "artifacts"
        : filename.includes("/content/entries/")
          ? "sources"
          : "other";
      const key = `${group}:${event}`;
      watchEvents[key] = (watchEvents[key] ?? 0) + 1;
    });
  };
  globalThis.__cgProfile = (name, start) => {
    const duration = performance.now() - start;
    const entry = (spans[name] ??= { calls: 0, totalMs: 0, maxMs: 0 });
    entry.calls++;
    entry.totalMs += duration;
    entry.maxMs = Math.max(entry.maxMs, duration);
    if (duration > 10 && entry.calls < 50) {
      events.push({ name, startMs: start - started, durationMs: duration });
    }
  };

  const names = new Set([
    "buildAtRoot",
    "createSession",
    "configure",
    "prepare",
    "loadRegistry",
    "loadGlob",
    "populateStore",
    "prepareRevision",
    "writeArtifacts",
    "revisionModules",
    "refreshModules",
    "ensureSession",
    "preparedModules",
    "watchProject",
    "watchSources",
    "renderMarkdown",
    "writeImmutable",
    "load",
    "buildStart",
    "configureServer",
  ]);
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (!url.includes("/content-query/packages/content-query/dist/") || !url.endsWith(".mjs")) {
        return result;
      }
      if (result.source === undefined || result.source === null) {
        return result;
      }
      const source =
        typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
      const parsed = ts.createSourceFile(
        url,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      const inserts = [];
      /** Extends returned promises so spans cover asynchronous work before their finally block. */
      function awaitReturns(node) {
        if (ts.isFunctionLike(node)) {
          return;
        }
        if (
          ts.isReturnStatement(node) &&
          node.expression &&
          !ts.isAwaitExpression(node.expression)
        ) {
          inserts.push([node.expression.getStart(parsed), "await "]);
        }
        ts.forEachChild(node, awaitReturns);
      }
      /** Instruments selected preparation functions without changing the files on disk. */
      function visit(node) {
        if (
          (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
          node.body &&
          node.name &&
          names.has(node.name.getText(parsed))
        ) {
          const name = node.name.getText(parsed);
          const label =
            name === "load"
              ? `${path.basename(url)}:${name}:${parsed.getLineAndCharacterOfPosition(node.pos).line + 1}`
              : name;
          const watch =
            name === "configureServer"
              ? `globalThis.__cgProfileServer(${node.parameters[0].name.getText(parsed)});`
              : "";
          inserts.push([
            node.body.getStart(parsed) + 1,
            `${watch}const __cgStart = performance.now(); try {`,
          ]);
          inserts.push([
            node.body.end - 1,
            `} finally {globalThis.__cgProfile(${JSON.stringify(label)}, __cgStart);}`,
          ]);
          if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
            ts.forEachChild(node.body, awaitReturns);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      let modified = source;
      for (const [position, text] of inserts.sort((left, right) => right[0] - left[0])) {
        modified = modified.slice(0, position) + text + modified.slice(position);
      }
      return { ...result, source: modified };
    },
  });

  for (const name of ["readFile", "writeFile", "mkdir", "link", "rm"]) {
    const original = promises[name];
    promises[name] = async function (...arguments_) {
      const filename = String(arguments_[0]);
      const group = filename.includes("/.content-query/")
        ? "artifacts"
        : filename.includes("/content/entries/")
          ? "sources"
          : "other";
      const start = performance.now();
      try {
        return await original.apply(this, arguments_);
      } finally {
        const entry = (io[`${group}:${name}`] ??= { calls: 0, totalMs: 0 });
        entry.calls++;
        entry.totalMs += performance.now() - start;
      }
    };
  }
  syncBuiltinESMExports();

  const session = process.env.CONTENT_QUERY_PROFILE_CPU === "1" ? new Session() : undefined;
  session?.connect();
  session?.post("Profiler.enable");
  session?.post("Profiler.setSamplingInterval", { interval: 1000 });
  session?.post("Profiler.start");
  let saved = false;
  /** Flushes profiles synchronously before normal exit or benchmark process-group cleanup. */
  function save() {
    if (saved) {
      return;
    }
    saved = true;
    fs.mkdirSync(directory, { recursive: true });
    const prefix = path.join(directory, `${process.pid}-${threadId}`);
    session?.post("Profiler.stop", (error, result) => {
      if (result) {
        fs.writeFileSync(`${prefix}.cpuprofile`, JSON.stringify(result.profile));
      }
      if (error) {
        events.push({ error: error.message });
      }
    });
    const watched = watchedServer?.watcher.getWatched() ?? {};
    fs.writeFileSync(
      `${prefix}.json`,
      JSON.stringify(
        {
          argv: process.argv,
          elapsedMs: performance.now() - started,
          spans,
          events,
          io,
          watchEvents,
          watchedDirectories: Object.keys(watched).length,
          watchedArtifacts: Object.keys(watched).filter((filename) =>
            filename.includes("/.content-query"),
          ).length,
        },
        null,
        2,
      ),
    );
    session?.disconnect();
  }
  process.once("exit", save);
  process.once("SIGTERM", () => {
    save();
    process.exit(143);
  });
}
