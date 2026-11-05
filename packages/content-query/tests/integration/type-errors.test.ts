import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import { packageRoot } from "../helpers/project.ts";

/** A consumer inside the package, so `zod` and the package sources resolve without a build. */
const consumer = path.join(packageRoot, "tests/fixtures/type-errors/consumer.ts");

/** Each call that a query or configuration disallows sits on its own line. */
const consumerSource = `
import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
import type { Collection } from "content-query/runtime";

const loader = { name: "memory", load: async () => {} };
const registry = {
  posts: defineCollection({ loader, schema: schema.object({ title: schema.string() }) }),
};
declare const posts: Collection<typeof registry, "posts">;
declare const fluentOnly: Collection<typeof registry, "posts", "fluent">;

export async function disallowed() {
  await posts.byId("hello").first();
  await posts.orderBy("title").all();
  await posts.select("title").limit(1).paginate({ page: 1, size: 1 });
  await posts.select("title").withPayload("_body").count();
  await fluentOnly.findFirst({ columns: { title: true } });
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

/** Type-checks the virtual consumer and returns its diagnostics by line, as printed. */
function consumerDiagnostics(): Map<string, string> {
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => (file === consumer ? consumerSource : readFile(file));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (file) => file === consumer || fileExists(file);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...rest) =>
    file === consumer
      ? ts.createSourceFile(file, consumerSource, ts.ScriptTarget.ESNext, true)
      : getSourceFile(file, ...rest);
  const program = ts.createProgram([consumer], options, host);
  const lines = consumerSource.split("\n");
  return new Map(
    ts.getPreEmitDiagnostics(program).flatMap((diagnostic) => {
      if (diagnostic.file?.fileName !== consumer || diagnostic.start === undefined) {
        return [];
      }
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return [[lines[line]!.trim(), ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")]];
    }),
  );
}

/** The printed error for calling a member whose type is `Unavailable<Reason>`. */
function notCallable(reason: string): string {
  return `This expression is not callable.\n  Type 'Unavailable<${JSON.stringify(reason)}>' has no call signatures.`;
}

let diagnostics: Map<string, string>;

// Building the program is the slow part, so do it once with room for a loaded machine.
beforeAll(() => {
  diagnostics = consumerDiagnostics();
}, 60_000);

describe("type errors for disallowed calls", () => {
  test("report only the disallowed calls", () => {
    expect(diagnostics.size).toBe(5);
  });

  test("name the selection rule when a query selects nothing", () => {
    const reason =
      "Select fields, relationships, payloads, or adjacent entries before running this query.";
    expect(diagnostics.get('await posts.byId("hello").first();')).toBe(notCallable(reason));
    expect(diagnostics.get('await posts.orderBy("title").all();')).toBe(notCallable(reason));
  });

  test("explain paginate() after limit() and count() after payloads", () => {
    expect(
      diagnostics.get('await posts.select("title").limit(1).paginate({ page: 1, size: 1 });'),
    ).toBe(
      notCallable(
        "paginate() sets the limit and offset itself; remove limit and offset from this query.",
      ),
    );
    expect(diagnostics.get('await posts.select("title").withPayload("_body").count();')).toBe(
      notCallable("Counts cannot request payloads; count without withPayload()."),
    );
  });

  test("name the query style that disables a member", () => {
    expect(diagnostics.get("await fluentOnly.findFirst({ columns: { title: true } });")).toBe(
      notCallable(
        'posts.findFirst is unavailable because content-query.config sets queryStyle to "fluent".',
      ),
    );
  });
});
