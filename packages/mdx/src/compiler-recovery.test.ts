import { describe, expect, test, vi } from "vite-plus/test";
import { createHighlighter } from "shiki";
import { compileMdx } from "./compiler.ts";

vi.mock("shiki", async (original) => {
  const module = await original<typeof import("shiki")>();
  return { ...module, createHighlighter: vi.fn(module.createHighlighter) };
});

describe("MDX highlighter recovery", () => {
  test("retries initialization after failure and shares the successful highlighter", async () => {
    vi.mocked(createHighlighter).mockRejectedValueOnce(new Error("Temporary highlighter failure"));
    const file = { path: "recovery.mdx", value: "```js\nconst value = 1;\n```" };
    await expect(compileMdx(file)).rejects.toThrow("Temporary highlighter failure");
    expect((await compileMdx(file)).code).toContain("shiki");
    expect((await compileMdx(file)).code).toContain("shiki");
    expect(createHighlighter).toHaveBeenCalledTimes(2);
  });
});
