import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ARTIFACT_VERSION, CODEC_VERSION, type ArtifactManifest } from "./types.ts";
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

/** Returns a gzip/base64 JavaScript literal only when it saves at least ten percent. */
function compactJson(source: string): string | undefined {
  const bytes = Buffer.byteLength(source);
  if (bytes < 4096) {
    return undefined;
  }
  const compressed = JSON.stringify(gzipSync(source, { level: 1 }).toString("base64"));
  return compressed.length < bytes * 0.9 ? compressed : undefined;
}

/** Creates portable ESM; build integrations can batch payload sources before a strict bundler runs. */
export async function revisionModules(
  revision: PreparedRevision,
  { payloadChunkBytes = 0 }: { payloadChunkBytes?: number } = {},
): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  const manifest: ArtifactManifest = {
    version: ARTIFACT_VERSION,
    codec: CODEC_VERSION,
    collections: revision.registry,
    ...(revision.queryStyle ? { queryStyle: revision.queryStyle } : {}),
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
      const source = JSON.stringify(Object.fromEntries(batch));
      const value = compactJson(source) ?? `JSON.parse(${JSON.stringify(source)})`;
      const code = `export default ${value};\n`;
      const key = digest([name, code]);
      publishPayload(`${directory}/entries/${key}.js`, code);
      chunks.push(
        `{ ids: ${JSON.stringify(batch.map(([id]) => id))}, load: () => import(${JSON.stringify(`./entries/${key}.js`)}) }`,
      );
      batch = [];
      batchBytes = 0;
    }
    for (const [id, load] of collection.builtins) {
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
    // Each custom payload variant is its own module; the variant key is folded into the hash.
    const custom: string[] = [];
    for (const [payload, entries] of collection.payloads ?? []) {
      const payloadDirectory = `payloads/${directoryName(payload)}`;
      const rows: string[] = [];
      for (const [id, variants] of entries) {
        const loaders: string[] = [];
        for (const [variant, load] of variants) {
          const encoded = encode(await load());
          const key = digest([name, payload, id, variant, encoded]);
          publishPayload(
            `${directory}/${payloadDirectory}/${key}.js`,
            `export default ${JSON.stringify(encoded)};\n`,
          );
          loaders.push(
            `${JSON.stringify(variant)}: () => import(${JSON.stringify(`./${payloadDirectory}/${key}.js`)})`,
          );
        }
        rows.push(`${JSON.stringify(id)}: { ${loaders.join(", ")} }`);
      }
      custom.push(`${JSON.stringify(payload)}: {\n${rows.join(",\n")}\n}`);
    }
    const recordSource = JSON.stringify(collection.records.map(encode));
    const compressedRecords = compactJson(recordSource);
    const helpers = [
      ...(chunks.length ? ["createPayloadLoaders"] : []),
      ...(compressedRecords ? ["decodeCompressed"] : []),
    ];
    const loaders = helpers.length
      ? `import { ${helpers.join(", ")} } from "content-query/internal";\n`
      : "";
    const loading = chunks.length
      ? `createPayloadLoaders([${chunks.join(",\n")}])`
      : `{ ${payloads.join(",\n")} }`;
    const records = compressedRecords ? `decodeCompressed(${compressedRecords})` : recordSource;
    const table = custom.length ? `, payloads: {\n${custom.join(",\n")}\n}` : "";
    const code = `${loaders}export default { records: ${records}, builtins: ${loading}${table} };\n`;
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
