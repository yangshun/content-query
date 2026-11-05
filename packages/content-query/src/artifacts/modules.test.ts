import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { projectFixture } from "../../tests/helpers/project.ts";
import type { BuiltinPayload, PreparedRevision } from "../runtime/revision.ts";
import type { QueryStyle } from "../runtime/query-style.ts";
import { revisionModules } from "./modules.ts";
import { ARTIFACT_VERSION, CODEC_VERSION } from "./types.ts";

const execute = promisify(execFile);

/** Prepares large, distinct payloads without depending on source acquisition or schemas. */
function largeRevision(compressible: boolean): PreparedRevision {
  const identifiers = [...Array.from({ length: 64 }, (_, index) => String(index)), "__proto__"];
  const builtins = new Map(
    identifiers.map((id) => {
      const heading = { depth: 1, slug: id, text: `Article ${id}` };
      const payload: BuiltinPayload = {
        body: `Body ${id}: ${compressible ? "Unicode 🦋 <tag> & \u0000\n".repeat(600) : randomBytes(12_000).toString("base64")}`,
        rendered: {
          html: `<h1 id="${id}">Article ${id}</h1>`,
          headings: [heading, heading],
        },
      };
      return [id, async () => payload] as const;
    }),
  );
  return {
    collections: {
      posts: {
        records: identifiers.map((id) => ({ id, date: new Date(0), value: 10n })),
        builtins,
        relationships: {},
      },
    },
    registry: {
      posts: {
        relationships: {},
        payloads: { _body: { variants: [] }, _rendered: { variants: [] } },
      },
    },
    relations: new Map(),
    active: 0,
    payloadCache: new Map(),
    renderCache: new Map(),
  };
}

describe("portable payload batches", () => {
  test.each([true, false])(
    "preserves portable content with compressible=%s",
    async (compressible) => {
      const fixture = await projectFixture();
      const revision = largeRevision(compressible);
      try {
        const modules = await revisionModules(revision, { payloadChunkBytes: 128 * 1024 });
        const sourceBytes = [...modules.values()].reduce(
          (total, source) => total + Buffer.byteLength(source),
          0,
        );
        const bodyBytes = (
          await Promise.all(
            [...revision.collections.posts!.builtins.values()].map((load) => load()),
          )
        ).reduce((total, payload) => total + Buffer.byteLength(payload.body!), 0);
        expect(sourceBytes).toBeLessThan(bodyBytes * (compressible ? 0.2 : 1.3));

        for (const [filename, source] of modules) {
          const destination = path.join(fixture.root, "portable", filename);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, source);
        }
        const { stdout } = await execute(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
const {posts} = await import("./portable/collections/posts/server.js");
const payload = async (id, name) => (await posts.findFirst({ where: { id }, columns: {}, payloads: { [name]: true } }))._payloads[name];
const bodies = await Promise.all(["0", "63", "__proto__"].map(async id => ({id, body: await payload(id, "_body")})));
const rendered = await payload("__proto__", "_rendered");
rendered.headings[0].text = "Caller mutation";
const next = await payload("__proto__", "_rendered");
const metadata = await posts.select("date", "value").first();
console.log(JSON.stringify({count: await posts.count(), bodies, aliases: rendered.headings[0] === rendered.headings[1], detached: next.headings[0].text, html: next.html, date: metadata.date instanceof Date && metadata.date.getTime(), bigint: metadata.value === 10n}));
`,
          ],
          { cwd: fixture.root },
        );
        expect(JSON.parse(stdout)).toEqual({
          count: 65,
          bodies: await Promise.all(
            ["0", "63", "__proto__"].map(async (id) => ({
              id,
              body: (await revision.collections.posts!.builtins.get(id)!()).body,
            })),
          ),
          aliases: true,
          detached: "Article __proto__",
          html: '<h1 id="__proto__">Article __proto__</h1>',
          date: 0,
          bigint: true,
        });
      } finally {
        await fixture.dispose();
      }
    },
  );
});

/** Reads the manifest literal that a generated module passes to JSON.parse. */
function manifestIn(source: string): Record<string, unknown> {
  const literal = /JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(source)?.[1];
  if (!literal) {
    throw new Error("Missing manifest literal.");
  }
  return JSON.parse(JSON.parse(literal) as string) as Record<string, unknown>;
}

describe("query style manifest", () => {
  /** A one-entry revision without payloads, optionally restricted to one query style. */
  function smallRevision(queryStyle?: QueryStyle): PreparedRevision {
    return {
      collections: { posts: { records: [{ id: "one" }], builtins: new Map(), relationships: {} } },
      registry: { posts: { relationships: {}, payloads: {} } },
      relations: new Map(),
      active: 0,
      payloadCache: new Map(),
      renderCache: new Map(),
      ...(queryStyle ? { queryStyle } : {}),
    };
  }

  test("records the configured style in each collection entry and the prepared entry", async () => {
    const modules = await revisionModules(smallRevision("relational"), { preparedEntry: true });
    expect(manifestIn(modules.get("collections/posts/server.js")!)).toMatchObject({
      queryStyle: "relational",
    });
    expect(manifestIn(modules.get("prepared-server.js")!)).toMatchObject({
      queryStyle: "relational",
    });
  });

  test("omits the style when both query styles are allowed", async () => {
    const modules = await revisionModules(smallRevision());
    expect(
      Object.hasOwn(manifestIn(modules.get("collections/posts/server.js")!), "queryStyle"),
    ).toBe(false);
    expect(modules.has("prepared-server.js")).toBe(false);
  });
});

describe("collection entries", () => {
  /** Two related collections; only `posts` captured Markdown. */
  function relatedRevision(): PreparedRevision {
    return {
      collections: {
        authors: { records: [{ id: "ada", name: "Ada" }], builtins: new Map(), relationships: {} },
        "blog-posts": {
          records: [{ id: "one", authorId: "ada" }],
          builtins: new Map([["one", async () => ({ markdown: "# One" })]]),
          relationships: {},
        },
      },
      registry: {
        authors: { relationships: {}, payloads: {} },
        "blog-posts": {
          relationships: {
            author: {
              collection: "authors",
              type: "one",
              from: "authorId",
              to: "id",
              referenceSide: "from",
            },
          },
          payloads: { _rendered: { variants: [] } },
          typeName: "Article",
        },
      },
      relations: new Map(),
      active: 0,
      payloadCache: new Map(),
      renderCache: new Map(),
    };
  }

  test("imports only the collection's own modules, under its export name", async () => {
    const modules = await revisionModules(relatedRevision());
    expect([...modules.keys()].filter((filename) => filename.endsWith("/server.js"))).toEqual([
      "collections/authors/server.js",
      "collections/blogPosts/server.js",
    ]);
    const posts = modules.get("collections/blogPosts/server.js")!;
    expect(posts).toMatch(/^export const blogPosts = /m);
    expect([...posts.matchAll(/import\(?\s*[^"]*"([^"]+)"/g)].map((match) => match[1])).toEqual([
      "content-query/internal",
      expect.stringMatching(/^\.\/index-[a-f0-9]{64}\.js$/),
      "content-query/internal/markdown",
    ]);
    expect(manifestIn(posts)).toEqual({
      version: ARTIFACT_VERSION,
      codec: CODEC_VERSION,
      // Only declarations read typeName, so the runtime manifest leaves it out.
      collections: {
        "blog-posts": {
          relationships: relatedRevision().registry["blog-posts"]!.relationships,
          payloads: { _rendered: { variants: [] } },
        },
      },
    });
    const authors = modules.get("collections/authors/server.js")!;
    expect(authors).not.toContain("blog");
    expect(authors).not.toContain("content-query/internal/markdown");
    expect(modules.has("server.js")).toBe(false);
    expect(modules.has("manifest.js")).toBe(false);
  });

  test("keeps module bindings distinct from the export name", async () => {
    const revision = relatedRevision();
    revision.collections = { data: revision.collections.authors! };
    revision.registry = { data: revision.registry.authors! };
    const source = (await revisionModules(revision)).get("collections/data/server.js")!;
    expect(source).toMatch(/^import data_ from/m);
    expect(source).toMatch(/^export const data = runtime\.createArtifactCollection\(.*data_\);$/m);
  });
});

/** Prepares a revision with a variant payload, a single payload, and an unsafe payload name. */
function customPayloadRevision(): PreparedRevision {
  const variants = (entries: Record<string, unknown>) =>
    new Map(Object.entries(entries).map(([key, value]) => [key, async () => value]));
  return {
    collections: {
      coding: {
        records: [{ id: "two-sum" }, { id: "reverse-list" }],
        builtins: new Map(),
        relationships: {},
        payloads: new Map([
          [
            "detail",
            new Map([
              [
                "two-sum",
                variants({
                  '{"locale":"en-US"}': { hints: ["Use a map"], date: new Date(0) },
                  '{"locale":"fr-FR"}': { hints: ["Utilisez une table"] },
                }),
              ],
              [
                "reverse-list",
                variants({ '{"locale":"en-US"}': { hints: ["Track the previous node"] } }),
              ],
            ]),
          ],
          ["step one", new Map([["two-sum", variants({ "{}": "Scan once." })]])],
        ]),
      },
    },
    registry: {
      coding: {
        relationships: {},
        payloads: { detail: { variants: ["locale"] }, "step one": { variants: [] } },
      },
    },
    relations: new Map(),
    active: 0,
    payloadCache: new Map(),
    renderCache: new Map(),
  };
}

describe("custom payload modules", () => {
  test("emits one module per entry and variant, loaded through the collection's payload table", async () => {
    const fixture = await projectFixture();
    try {
      const modules = await revisionModules(customPayloadRevision());
      const payloadModules = [...modules.keys()].filter((filename) =>
        filename.includes("/payloads/"),
      );
      expect(payloadModules).toHaveLength(4);
      expect(
        payloadModules.filter((filename) =>
          /^collections\/coding\/payloads\/detail\/[a-f0-9]{64}\.js$/.test(filename),
        ),
      ).toHaveLength(3);
      expect(
        payloadModules.filter((filename) => filename.startsWith("collections/coding/payloads/~")),
      ).toHaveLength(1);
      for (const [filename, source] of modules) {
        const destination = path.join(fixture.root, "portable", filename);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, source);
      }
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
const {coding} = await import("./portable/collections/coding/server.js");
const detail = async (id, locale) => (await coding.findFirst({ where: { id }, payloads: { detail: { locale } } }))._payloads.detail;
const english = await detail("two-sum", "en-US");
const french = await detail("two-sum", "fr-FR");
const step = (await coding.findFirst({ where: { id: "two-sum" }, payloads: { "step one": true } }))._payloads["step one"];
const missing = await detail("reverse-list", "fr-FR").catch(error => ({ code: error.code, payload: error.payload, variant: error.variant }));
console.log(JSON.stringify({ english: english.hints, date: english.date instanceof Date && english.date.getTime(), french: french.hints, step, missing }));
`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({
        english: ["Use a map"],
        date: 0,
        french: ["Utilisez une table"],
        step: "Scan once.",
        missing: { code: "variant-not-found", payload: "detail", variant: { locale: "fr-FR" } },
      });
    } finally {
      await fixture.dispose();
    }
  });
});

describe("prepared payload encodings", () => {
  test("publishes a node's encoded text without loading or re-encoding its value", async () => {
    const revision = customPayloadRevision();
    const encoded = JSON.stringify('["Prepared once"]');
    const load = Object.assign(
      async () => {
        throw new Error("Prepared nodes are not loaded again to publish.");
      },
      { encoded: '["Prepared once"]' },
    );
    revision.collections.coding!.payloads = new Map([
      ["detail", new Map([["two-sum", new Map([['{"locale":"en-US"}', load]])]])],
    ]);
    const modules = await revisionModules(revision);
    const [source] = [...modules]
      .filter(([filename]) => filename.includes("/payloads/detail/"))
      .map(([, code]) => code);
    expect(source).toBe(`export default ${encoded};\n`);
  });
});
