import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { collectionDeclarations } from "../../src/artifacts/declarations.ts";
import { collectionNames } from "../../src/collection/names.ts";
import { packageRoot } from "../helpers/project.ts";

/**
 * In-memory project inside the package, so `zod` and the package sources resolve without a build.
 * The collection entries are the real generated declarations.
 */
const root = path.join(packageRoot, "tests/fixtures/field-docs");
const config = path.join(root, "content-query.config.ts");
const consumer = path.join(root, "consumer.ts");

const configSource = `
import { defineCollection } from "content-query";
import { schema } from "content-query/schema";

const loader = { name: "memory", load: async () => {} };

export const collections = {
  guides: defineCollection({
    loader,
    schema: schema.object({
      /** The guide's headline. */
      title: schema.string(),
      /** A one-line summary for listings. */
      summary: schema.string().optional(),
      /** The ID of the author who wrote the guide. */
      authorId: schema.string(),
      draft: schema.boolean().describe("Runtime metadata, not a type comment."),
    }),
    computed: {
      /** Estimated reading time in minutes. */
      minutes: { schema: schema.number(), resolve: () => 1 },
    },
    relationships: {
      author: { collection: "authors", type: "one", from: "authorId", to: "id", referenceSide: "from" },
    },
  }),
  authors: defineCollection({
    loader,
    schema: schema.object({
      /** The author's display name. */
      name: schema.string(),
    }),
  }),
};
`;

/** Places `/*@name*\/` before an identifier to hover it. */
const consumerSource = `
import { guides, type ContentGuide } from "./.content-query/collections/guides/server.js";
import { authors } from "./.content-query/collections/authors/server.js";

declare const full: ContentGuide;
declare const picked: ContentGuide<"title" | "summary">;
full./*@full-title*/title;
full./*@full-minutes*/minutes;
full./*@full-id*/id;
full./*@full-draft*/draft;
picked./*@picked-title*/title;
picked./*@picked-summary*/summary;

export async function fluent() {
  const [row] = await guides.using(authors).select("title", "summary").with("author", (author) => author.select("name")).all();
  row./*@fluent-title*/title;
  row./*@fluent-summary*/summary;
  row.author./*@fluent-author-name*/name;
  const [listed] = await guides.select("title").selectAdjacent("title").all();
  listed._adjacent.previous?./*@fluent-adjacent-title*/title;
  const [sibling] = await guides.select("title").selectAdjacent({ select: { summary: true } }).all();
  sibling._adjacent.next?./*@fluent-sibling-summary*/summary;
  const guide = await guides.byId("intro").select("title").select("minutes");
  guide?./*@fluent-by-id-title*/title;
  guide?./*@fluent-by-id-minutes*/minutes;
}

export async function relational() {
  const [row] = await guides.using(authors).findMany({
    columns: { title: true, summary: true, minutes: true },
    with: { author: { columns: { name: true } } },
    adjacent: { scope: "results", columns: { title: true } },
  });
  row./*@relational-title*/title;
  row./*@relational-summary*/summary;
  row./*@relational-minutes*/minutes;
  row.author./*@relational-author-name*/name;
  row._adjacent.previous?./*@relational-adjacent-title*/title;
}
`;

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
  paths: {
    "content-query": [path.join(packageRoot, "src/index.ts")],
    "content-query/*": [path.join(packageRoot, "src/*.ts")],
  },
};

/** Creates a language service over the virtual config, generated entries, and consumer. */
function createService(): ts.LanguageService {
  const files = new Map([
    [config, configSource],
    [consumer, consumerSource],
  ]);
  const names = collectionNames({ guides: {}, authors: {} });
  for (const [name, generated] of names) {
    const directory = path.join(root, ".content-query/collections", generated.exportName);
    files.set(
      path.join(directory, "server.d.ts"),
      collectionDeclarations(directory, config, name, generated),
    );
  }
  const read = (file: string) => files.get(file) ?? ts.sys.readFile(file);
  return ts.createLanguageService(
    {
      getScriptFileNames: () => [consumer],
      getScriptVersion: () => "1",
      getScriptSnapshot: (file) => {
        const text = read(file);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
      fileExists: (file) => files.has(file) || ts.sys.fileExists(file),
      readFile: read,
      readDirectory: (...arguments_) => ts.sys.readDirectory(...arguments_),
      directoryExists: (directory) =>
        directory === root || directory.startsWith(`${root}${path.sep}`)
          ? true
          : ts.sys.directoryExists(directory),
      getDirectories: (directory) => ts.sys.getDirectories(directory),
    },
    ts.createDocumentRegistry(),
  );
}

let service: ts.LanguageService;
let diagnostics: string[];

// Building the program is the slow part, so do it once with room for a loaded machine.
beforeAll(() => {
  service = createService();
  diagnostics = service
    .getSemanticDiagnostics(consumer)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}, 60_000);

/**
 * Hovers the identifier after a marker in the consumer.
 *
 * @param marker - The marker's name, as written in `/*@name*\/`.
 * @returns The hover's documentation and its signature text.
 */
function hover(marker: string): { documentation: string; signature: string } {
  const token = `/*@${marker}*/`;
  const index = consumerSource.indexOf(token);
  if (index === -1) {
    throw new Error(`Missing marker ${marker}.`);
  }
  const info = service.getQuickInfoAtPosition(consumer, index + token.length);
  return {
    documentation: ts.displayPartsToString(info?.documentation),
    signature: ts.displayPartsToString(info?.displayParts),
  };
}

describe("field documentation", () => {
  test("type-checks the consumer", () => {
    expect(diagnostics).toEqual([]);
  });

  describe("generated entry types", () => {
    test("shows schema and computed field comments on the full entry", () => {
      expect(hover("full-title").documentation).toBe("The guide's headline.");
      expect(hover("full-minutes").documentation).toBe("Estimated reading time in minutes.");
      expect(hover("full-id").documentation).toBe("The entry's ID, unique within its collection.");
    });

    test("does not turn runtime schema metadata into comments", () => {
      expect(hover("full-draft").documentation).toBe("");
    });

    test("keeps comments on selected fields, which stay required", () => {
      expect(hover("picked-title").documentation).toBe("The guide's headline.");
      expect(hover("picked-summary")).toEqual({
        documentation: "A one-line summary for listings.",
        signature: "(property) summary: string | undefined",
      });
    });
  });

  describe("fluent query results", () => {
    test("keeps comments on selected fields", () => {
      expect(hover("fluent-title").documentation).toBe("The guide's headline.");
      expect(hover("fluent-summary")).toEqual({
        documentation: "A one-line summary for listings.",
        signature: "(property) summary: string | undefined",
      });
    });

    test("keeps comments on fields a byId() query selects across select() calls", () => {
      expect(hover("fluent-by-id-title").documentation).toBe("The guide's headline.");
      expect(hover("fluent-by-id-minutes").documentation).toBe(
        "Estimated reading time in minutes.",
      );
    });

    test("keeps comments on related and adjacent fields", () => {
      expect(hover("fluent-author-name").documentation).toBe("The author's display name.");
      expect(hover("fluent-adjacent-title").documentation).toBe("The guide's headline.");
      expect(hover("fluent-sibling-summary")).toEqual({
        documentation: "A one-line summary for listings.",
        signature: "(property) summary: string | undefined",
      });
    });
  });

  describe("relational query results", () => {
    test("keeps comments on selected columns", () => {
      expect(hover("relational-title").documentation).toBe("The guide's headline.");
      expect(hover("relational-minutes").documentation).toBe("Estimated reading time in minutes.");
      expect(hover("relational-summary")).toEqual({
        documentation: "A one-line summary for listings.",
        signature: "(property) summary: string | undefined",
      });
    });

    test("keeps comments on related and adjacent columns", () => {
      expect(hover("relational-author-name").documentation).toBe("The author's display name.");
      expect(hover("relational-adjacent-title").documentation).toBe("The guide's headline.");
    });
  });
});
