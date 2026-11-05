import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ARTIFACT_VERSION, CODEC_VERSION, type ArtifactManifest } from "./types.ts";
import type { PreparedRevision } from "../runtime/revision.ts";
import { collectionNames } from "../collection/names.ts";
import { encode } from "../shared/values.ts";

/** Creates an opaque content-addressed key with an unambiguous serialization boundary. */
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Maps collection and payload names to distinct safe directory names without changing public
 * identities. Names that are not portable directory names are base64url-encoded behind `~`.
 *
 * @param name - The collection or payload name.
 * @returns The directory name under `collections/` or a collection's `payloads/`.
 */
export function directoryName(name: string): string {
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

/** Picks a module-local binding that cannot shadow the entry's export name. */
function binding(base: string, exportName: string): string {
  return base === exportName ? `${base}_` : base;
}

/**
 * Creates one collection's entry, which exports the collection's query handle under its export
 * name and imports only that collection's modules.
 */
function collectionEntry(
  manifest: ArtifactManifest,
  name: string,
  exportName: string,
  index: string,
  renderer: boolean,
): string {
  const runtime = binding("runtime", exportName);
  const data = binding("data", exportName);
  const render = renderer
    ? `, body => import("content-query/internal/markdown").then(module => module.renderMarkdown(body))`
    : "";
  return `import * as ${runtime} from "content-query/internal";\nimport ${data} from ${JSON.stringify(`./${index}`)};\nexport const ${exportName} = ${runtime}.createArtifactCollection(JSON.parse(${JSON.stringify(JSON.stringify(manifest))}), ${JSON.stringify(name)}, ${data}${render});\n`;
}

/**
 * Creates portable ESM; build integrations can batch payload sources before a strict bundler runs.
 *
 * Each collection gets `collections/<export name>/server.js`, which exports its query handle and
 * imports only that collection's modules, so a bundle that imports it never references the
 * modules of another collection.
 *
 * @param revision - The prepared revision to publish.
 * @param options - `payloadChunkBytes` batches payload modules for bundlers. `preparedEntry`
 * also emits `prepared-server.js`, which exports the whole revision for development facades.
 * @returns Module sources keyed by path relative to the output directory.
 */
export async function revisionModules(
  revision: PreparedRevision,
  {
    payloadChunkBytes = 0,
    preparedEntry = false,
  }: { payloadChunkBytes?: number; preparedEntry?: boolean } = {},
): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  const names = collectionNames(revision.registry);
  /** Each collection's index module, for the optional prepared entry. */
  const indexes: [name: string, specifier: string][] = [];
  let anyMarkdown = false;
  for (const [name, collection] of Object.entries(revision.collections)) {
    const { exportName } = names.get(name)!;
    const directory = `collections/${exportName}`;
    /** Whether the collection captured Markdown, which the packaged renderer renders on demand. */
    let markdown = false;
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
      markdown ||= payload.markdown !== undefined;
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
          // Prepared nodes carry their encoded text, so republishing skips re-encoding them.
          const encoded = (load as { encoded?: string }).encoded ?? encode(await load());
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
    const descriptor = revision.registry[name]!;
    const manifest: ArtifactManifest = {
      version: ARTIFACT_VERSION,
      codec: CODEC_VERSION,
      collections: {
        [name]: {
          relationships: descriptor.relationships,
          ...(descriptor.payloads ? { payloads: descriptor.payloads } : {}),
        },
      },
      ...(revision.queryStyle ? { queryStyle: revision.queryStyle } : {}),
    };
    modules.set(
      `${directory}/server.js`,
      collectionEntry(manifest, name, exportName, index, markdown),
    );
    indexes.push([name, `./${directory}/${index}`]);
    anyMarkdown ||= markdown;
  }
  if (preparedEntry) {
    const manifest: ArtifactManifest = {
      version: ARTIFACT_VERSION,
      codec: CODEC_VERSION,
      collections: Object.fromEntries(
        Object.entries(revision.registry).map(([name, { relationships, payloads }]) => [
          name,
          { relationships, ...(payloads ? { payloads } : {}) },
        ]),
      ),
      ...(revision.queryStyle ? { queryStyle: revision.queryStyle } : {}),
    };
    const render = anyMarkdown
      ? `, body => import("content-query/internal/markdown").then(module => module.renderMarkdown(body))`
      : "";
    modules.set(
      "prepared-server.js",
      `import { createArtifactRevision } from "content-query/internal";\n${indexes.map(([, specifier], index) => `import collection${index} from ${JSON.stringify(specifier)};`).join("\n")}\nexport const revision = createArtifactRevision(JSON.parse(${JSON.stringify(JSON.stringify(manifest))}), { ${indexes.map(([name], index) => `[${JSON.stringify(name)}]: collection${index}`).join(", ")} }${render});\nexport const registry = revision.registry;\nexport const error = undefined;\n`,
    );
  }
  return modules;
}
