import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { schema } from "../schema.ts";
import { ContentError } from "../shared/errors.ts";
import { createEntryFiles, entryFolder, type Dependency } from "./files.ts";

let root: string;
const folder = () => path.join(root, "content/coding/two-sum");
const shared = () => path.join(root, "content/coding/_shared");

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-files-")));
  await mkdir(path.join(folder(), "hints"), { recursive: true });
  await mkdir(shared(), { recursive: true });
  await writeFile(path.join(folder(), "hints/en-US.md"), "---\ntitle: Map\n---\nUse a map.\n");
  await writeFile(path.join(folder(), "hints/fr-FR.md"), "---\ntitle: Table\n---\nUne table.\n");
  await writeFile(path.join(folder(), "cases.json"), JSON.stringify([{ id: "a", input: 1 }]));
  await writeFile(path.join(folder(), "solution.ts"), "export {};\n");
  await writeFile(path.join(shared(), "harness.ts"), "// harness\n");
  await writeFile(path.join(root, "secret.txt"), "outside");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Creates helpers for the two-sum entry, collecting what they read. */
function helpers(options: { folder?: string | undefined; shared?: string[] } = {}) {
  const dependencies: Dependency[] = [];
  const files = createEntryFiles({
    root,
    folder: "folder" in options ? options.folder : folder(),
    shared: options.shared ?? [],
    entry: "two-sum",
    signal: new AbortController().signal,
    dependencies,
  });
  return { files, dependencies };
}

describe("entryFolder", () => {
  test("prefers source.directory, then the folder of source.filePath", () => {
    expect(entryFolder("/project", { directory: "content/x", filePath: "a/b.md" })).toBe(
      path.resolve("/project/content/x"),
    );
    expect(entryFolder("/project", { filePath: "content/coding/two-sum/exercise.json" })).toBe(
      path.resolve("/project/content/coding/two-sum"),
    );
    expect(entryFolder("/project", { key: "one" })).toBeUndefined();
    expect(entryFolder("/project", undefined)).toBeUndefined();
  });
});

describe("createEntryFiles", () => {
  test("reads text and bytes relative to the entry folder and records each file", async () => {
    const { files, dependencies } = helpers();
    expect(await files.text("solution.ts")).toBe("export {};\n");
    expect(new TextDecoder().decode(await files.bytes("solution.ts"))).toBe("export {};\n");
    expect(dependencies).toEqual([
      { kind: "file", path: path.join(folder(), "solution.ts") },
      { kind: "file", path: path.join(folder(), "solution.ts") },
    ]);
  });

  test("globs like glob(), validating each entry and recording the glob and its files", async () => {
    const { files, dependencies } = helpers();
    const hints = await files.glob({
      pattern: "hints/*.md",
      schema: schema.object({ title: schema.string() }),
    });
    expect(hints).toEqual([
      {
        id: "hints/en-us",
        data: { title: "Map" },
        body: "Use a map.\n",
        filePath: "content/coding/two-sum/hints/en-US.md",
      },
      {
        id: "hints/fr-fr",
        data: { title: "Table" },
        body: "Une table.\n",
        filePath: "content/coding/two-sum/hints/fr-FR.md",
      },
    ]);
    expect(dependencies).toEqual([
      { kind: "glob", base: folder(), options: expect.objectContaining({ pattern: "hints/*.md" }) },
      { kind: "file", path: path.join(folder(), "hints/en-US.md") },
      { kind: "file", path: path.join(folder(), "hints/fr-FR.md") },
    ]);
    const bodiless = await helpers().files.glob({ pattern: "hints/en-US.md", retainBody: false });
    expect(bodiless[0]).not.toHaveProperty("body");
    expect(await helpers().files.glob({ pattern: "missing/*.md" })).toEqual([]);
  });

  test("parses data files like file() and reports schema failures against the file", async () => {
    const { files, dependencies } = helpers();
    expect(await files.file("cases.json")).toEqual([
      { id: "a", data: { input: 1 }, filePath: "content/coding/two-sum/cases.json" },
    ]);
    expect(dependencies).toEqual([{ kind: "file", path: path.join(folder(), "cases.json") }]);
    const failure = await files
      .file("cases.json", { schema: schema.object({ input: schema.string() }) })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ContentError);
    expect(failure).toMatchObject({
      code: "validation-error",
      source: `${path.join(folder(), "cases.json")}#0`,
      path: ["input"],
    });
  });

  test("renders Markdown like a loader's renderMarkdown()", async () => {
    const rendered = await helpers().files.renderMarkdown("## Approach\n\nScan once.");
    expect(rendered.html).toContain('<h2 id="approach">Approach</h2>');
    expect(rendered.metadata?.headings).toEqual([{ depth: 2, slug: "approach", text: "Approach" }]);
  });

  test("allows the entry folder and shared directories, and nothing else", async () => {
    const { files } = helpers({ shared: [shared()] });
    expect(await files.text("../_shared/harness.ts")).toBe("// harness\n");
    expect(await files.text(path.join(shared(), "harness.ts"))).toBe("// harness\n");
    await expect(helpers().files.text("../_shared/harness.ts")).rejects.toThrow(
      /outside entry "two-sum"/,
    );
    await expect(files.text("../../../secret.txt")).rejects.toThrow(/sharedFiles/);
    await expect(files.text("missing.md")).rejects.toMatchObject({
      code: "source-error",
      source: path.join(folder(), "missing.md"),
    });
    await expect(files.glob({ pattern: "../*.ts" })).rejects.toThrow(/relative patterns/);
    await expect(files.glob({ pattern: "/etc/*" })).rejects.toThrow(/relative patterns/);
    await expect(files.text("")).rejects.toThrow(/nonempty path/);
  });

  test("explains that entries without a folder cannot read relative files", async () => {
    const { files } = helpers({ folder: undefined, shared: [shared()] });
    await expect(files.text("hints/en-US.md")).rejects.toThrow(/has no folder for files helpers/);
    expect(await files.text(path.join(shared(), "harness.ts"))).toBe("// harness\n");
  });
});
