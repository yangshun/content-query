import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { projectFixture } from "../../tests/helpers/project.ts";
import type { ItemPayload, PreparedRevision } from "../runtime/revision.ts";
import { revisionModules } from "./modules.ts";

const execute = promisify(execFile);

/** Prepares large, distinct payloads without depending on source acquisition or schemas. */
function largeRevision(compressible: boolean): PreparedRevision {
  const identifiers = [...Array.from({ length: 64 }, (_, index) => String(index)), "__proto__"];
  const payloads = new Map(
    identifiers.map((id) => {
      const heading = { depth: 1, slug: id, text: `Article ${id}` };
      const payload: ItemPayload = {
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
        payloads,
        relationships: {},
      },
    },
    registry: { posts: { relationships: {} } },
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
            [...revision.collections.posts!.payloads.values()].map((load) => load()),
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
const {content} = await import("./portable/server.js");
const bodies = await Promise.all(["0", "63", "__proto__"].map(async id => ({id, body: await content.readBody("posts", id)})));
const rendered = await content.render("posts", "__proto__");
rendered.headings[0].text = "Caller mutation";
const next = await content.render("posts", "__proto__");
const metadata = await content.select("date", "value").from("posts").first();
console.log(JSON.stringify({count: await content.count("posts"), bodies, aliases: rendered.headings[0] === rendered.headings[1], detached: next.headings[0].text, html: next.html, date: metadata.date instanceof Date && metadata.date.getTime(), bigint: metadata.value === 10n}));
`,
          ],
          { cwd: fixture.root },
        );
        expect(JSON.parse(stdout)).toEqual({
          count: 65,
          bodies: await Promise.all(
            ["0", "63", "__proto__"].map(async (id) => ({
              id,
              body: (await revision.collections.posts!.payloads.get(id)!()).body,
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
