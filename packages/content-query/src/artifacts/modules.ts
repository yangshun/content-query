import { createHash } from "node:crypto";
import { ARTIFACT_VERSION, CODEC_VERSION } from "./types.ts";
import type { PreparedRevision } from "../runtime/revision.ts";
import { encode } from "../shared/values.ts";

/** Creates an opaque content-addressed key with an unambiguous serialization boundary. */
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Maps collection names to distinct safe directory names without changing public identities. */
function directoryName(name: string): string {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)
    ? name
    : `~${Buffer.from(name).toString("base64url")}`;
}

/** Creates portable ESM; build integrations can batch payload sources before a strict bundler runs. */
export async function revisionModules(
  revision: PreparedRevision,
  { payloadChunkBytes = 0 }: { payloadChunkBytes?: number } = {},
): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  const manifest = {
    version: ARTIFACT_VERSION,
    codec: CODEC_VERSION,
    collections: revision.registry,
  };
  const imports: string[] = [];
  const names: string[] = [];
  let needsRenderer = false;
  for (const [name, collection] of Object.entries(revision.collections)) {
    const directory = `collections/${directoryName(name)}`;
    const payloads: string[] = [];
    const chunks: string[] = [];
    let batch: [string, string][] = [];
    let batchBytes = 0;
    /** Retains collision checks for both individual payloads and batched source modules. */
    function publishPayload(filename: string, code: string): void {
      if (modules.has(filename) && modules.get(filename) !== code) {
        throw new Error("Payload hash collision.");
      }
      modules.set(filename, code);
    }
    /** Emits one lazy source module without creating a dynamic-import entry per item. */
    function flushBatch(): void {
      if (!batch.length) {
        return;
      }
      const key = digest([name, batch]);
      const code = `export default { ${batch.map(([id, encoded]) => `[${JSON.stringify(id)}]: ${JSON.stringify(encoded)}`).join(",\n")} };\n`;
      publishPayload(`${directory}/entries/${key}.js`, code);
      const binding = `payloadChunk${chunks.length}`;
      chunks.push(`const ${binding} = () => import(${JSON.stringify(`./entries/${key}.js`)});`);
      for (const [id] of batch) {
        payloads.push(`[${JSON.stringify(id)}]: loadPayload(${binding}, ${JSON.stringify(id)})`);
      }
      batch = [];
      batchBytes = 0;
    }
    for (const [id, load] of collection.payloads) {
      const payload = await load();
      const encoded = encode(payload);
      needsRenderer ||= payload.markdown !== undefined;
      if (payloadChunkBytes) {
        const bytes = Buffer.byteLength(`[${JSON.stringify(id)}]: ${JSON.stringify(encoded)},\n`);
        if (batchBytes && batchBytes + bytes > payloadChunkBytes) {
          flushBatch();
        }
        batch.push([id, encoded]);
        batchBytes += bytes;
        continue;
      }
      const key = digest([name, id, encoded]);
      const filename = `${directory}/entries/${key}.js`;
      const code = `export default ${JSON.stringify(encoded)};\n`;
      publishPayload(filename, code);
      payloads.push(
        `[${JSON.stringify(id)}]: () => import(${JSON.stringify(`./entries/${key}.js`)})`,
      );
    }
    flushBatch();
    const loaders = chunks.length
      ? `const loadPayload = (load, id) => () => load().then(module => ({ default: module.default[id] }));\n${chunks.join("\n")}\n`
      : "";
    const code = `${loaders}export default { records: ${JSON.stringify(collection.records.map(encode))}, payloads: { ${payloads.join(",\n")} } };\n`;
    const index = `index-${digest(code)}.js`;
    modules.set(`${directory}/${index}`, code);
    modules.set(
      `${directory}/index.js`,
      `export { default } from ${JSON.stringify(`./${index}`)};\n`,
    );
    const binding = `collection${imports.length}`;
    imports.push(`import ${binding} from ${JSON.stringify(`./${directory}/${index}`)};`);
    names.push(`[${JSON.stringify(name)}]: ${binding}`);
  }
  modules.set(
    "manifest.js",
    `export default JSON.parse(${JSON.stringify(JSON.stringify(manifest))});\n`,
  );
  const renderer = needsRenderer
    ? `, body => import("content-query/internal/markdown").then(module => module.renderMarkdown(body))`
    : "";
  modules.set(
    "server.js",
    `import { createArtifactRuntime } from "content-query/internal";\n${imports.join("\n")}\nexport const content = createArtifactRuntime(JSON.parse(${JSON.stringify(JSON.stringify(manifest))}), { ${names.join(", ")} }${renderer});\n`,
  );
  return modules;
}
