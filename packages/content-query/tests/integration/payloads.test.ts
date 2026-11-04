import { execFile } from "node:child_process";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { packageRoot, projectFixture } from "../helpers/project.ts";

const execute = promisify(execFile);

const config = `import { defineCollection } from "content-query";
import { glob } from "content-query/loaders";
import { schema } from "content-query/schema";

const coding = defineCollection({
  loader: glob({ base: "./content/coding", pattern: "*/exercise.json", generateId: ({ entry }) => entry.split("/")[0]! }),
  schema: schema.object({ title: schema.string(), difficulty: schema.string(), locales: schema.array(schema.string()) }),
  payloads: {
    detail: {
      schema: schema.object({ locale: schema.string(), hints: schema.string() }),
      variants: { locale: "locales" },
      resolve: async ({ files, variant }) => ({ locale: variant.locale, hints: (await files.text(\`hints/\${variant.locale}.md\`)).trim() }),
    },
    walkthrough: {
      schema: schema.string(),
      resolve: async ({ files }) => (await files.text("walkthrough.md")).trim(),
    },
  },
});

export const collections = { coding };
`;

const consumer = `import { content, type CollectionPayload } from "./.content-query/server.js";
const hints: CollectionPayload<"coding", "detail">["hints"] = "Use a map";
const walkthrough: CollectionPayload<"coding", "walkthrough"> = "Scan once";
const detail: Promise<{ title: string; _payloads: { detail: { locale: string; hints: string } } } | undefined> =
  content.query.coding.findFirst({ where: { id: "two-sum" }, columns: { title: true }, payloads: { detail: { locale: "en-US" } } });
const fluent = content.from("coding").select("id").withPayload("detail", { locale: "fr-FR" }).withPayload("walkthrough").all();
// @ts-expect-error Variant payloads require their keys through generated declarations.
void content.query.coding.findFirst({ payloads: { detail: true } });
// @ts-expect-error Payload names come from the configured collection.
void content.query.coding.findFirst({ payloads: { missing: true } });
void [hints, walkthrough, detail, fluent];
`;

describe("custom payloads in generated builds", () => {
  test("builds one module per variant, types them, and serves them without sources", async () => {
    const fixture = await projectFixture();
    try {
      await cp(
        path.join(packageRoot, "tests/fixtures/exercises/coding"),
        path.join(fixture.root, "content/coding"),
        { recursive: true },
      );
      await writeFile(fixture.config, config);
      await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'const { buildContent } = await import("content-query/build"); const session = await buildContent(); await session.dispose();',
        ],
        { cwd: fixture.root },
      );
      const payloads = path.join(fixture.root, ".content-query/collections/coding/payloads");
      expect(await readdir(path.join(payloads, "detail"))).toHaveLength(3);
      expect(await readdir(path.join(payloads, "walkthrough"))).toHaveLength(2);

      await writeFile(path.join(fixture.root, "consumer.ts"), consumer);
      await execute(
        process.execPath,
        [
          path.join(packageRoot, "node_modules/tsrs/bin/tsrs"),
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--module",
          "nodenext",
          "--target",
          "esnext",
          "--allowImportingTsExtensions",
          "consumer.ts",
        ],
        { cwd: fixture.root },
      ).catch((error: { stdout?: string; stderr?: string }) => {
        // Surface the compiler's diagnostics instead of only the failed command line.
        throw new Error(`Consumer type check failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`);
      });

      // Production reads only generated output, so the sources can disappear.
      await rm(path.join(fixture.root, "content"), { recursive: true });
      await rm(fixture.config);
      const { stdout } = await execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const { content } = await import("./.content-query/server.js");
const english = await content.query.coding.findFirst({ where: { id: "two-sum" }, columns: { title: true }, payloads: { detail: { locale: "en-US" }, walkthrough: true } });
const french = await content.from("coding").select("id").orderBy("id").withPayload("detail", { locale: "fr-FR" }).first().catch((error) => ({ code: error.code }));
const missing = await content.query.coding.findFirst({ where: { id: "reverse-list" }, payloads: { detail: { locale: "fr-FR" } } }).catch((error) => ({ code: error.code, payload: error.payload, variant: error.variant }));
console.log(JSON.stringify({ english, missing, frenchCode: french.code ?? null }));`,
        ],
        { cwd: fixture.root },
      );
      expect(JSON.parse(stdout)).toEqual({
        english: {
          title: "Two Sum",
          _payloads: {
            detail: { locale: "en-US", hints: "Store each number's index in a map as you scan." },
            walkthrough: "For each number, look up its complement before storing it.",
          },
        },
        missing: { code: "variant-not-found", payload: "detail", variant: { locale: "fr-FR" } },
        frenchCode: "variant-not-found",
      });
    } finally {
      await fixture.dispose();
    }
  });
});
