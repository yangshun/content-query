import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { packageRoot } from "../helpers/project.ts";

const execute = promisify(execFile);

describe("packaged Markdown renderer", () => {
  test("loads syntax-highlighting dependencies only when a fenced block needs them", async () => {
    const entry = pathToFileURL(path.join(packageRoot, "dist/internal/markdown.mjs")).href;
    const { stdout } = await execute(process.execPath, [
      "--input-type=module",
      "-e",
      `import {registerHooks} from "node:module";
const loaded = [];
registerHooks({load(url, context, next) {
  if (url.includes("/shiki/") || url.includes("/@shikijs/")) loaded.push(url);
  return next(url, context);
}});
const {renderMarkdown} = await import(${JSON.stringify(entry)});
const plain = await renderMarkdown("# Ready\\n\\nText\\n");
const afterPlain = [...loaded];
const fenced = await renderMarkdown("\`\`\`js\\nconst value = 42;\\n\`\`\`");
console.log(JSON.stringify({plain, afterPlain, afterFence: loaded, fenced}));`,
    ]);
    const result = JSON.parse(stdout);
    expect(result.afterPlain).toEqual([]);
    expect(result.plain.html).toBe('<h1 id="ready">Ready</h1>\n<p>Text</p>\n');
    expect(result.afterFence.length).toBeGreaterThan(0);
    expect(result.fenced.html).toContain("shiki");
  });
});
