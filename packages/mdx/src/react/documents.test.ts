import { describe, expect, test, vi } from "vite-plus/test";
import { loadMdx } from "../client.ts";
import { registerDocument, resolveDocument } from "./documents.ts";

vi.mock("../client.ts", () => ({ loadMdx: vi.fn() }));

describe("selected React document modules", () => {
  test("uses a server-registered module without importing browser assets", () => {
    const reference = { url: "/registered.js", css: [] };
    const module = { default: () => null, headings: [] };
    registerDocument(reference, module);
    expect(resolveDocument(reference)).toBe(module);
    expect(loadMdx).not.toHaveBeenCalled();
    const updated = { ...module, revision: 2 };
    registerDocument(reference, updated);
    expect(resolveDocument(reference)).toBe(updated);
  });

  test("shares one selected import promise and retries after a rejected import", async () => {
    const reference = { url: "/retry-document.js", css: ["/document.css"] };
    vi.mocked(loadMdx).mockRejectedValueOnce(new Error("Missing document"));
    const first = resolveDocument(reference);
    expect(resolveDocument(reference)).toBe(first);
    await expect(first).rejects.toThrow("Missing document");
    const module = { default: () => null, headings: [] };
    vi.mocked(loadMdx).mockResolvedValueOnce(module);
    await expect(resolveDocument(reference)).resolves.toBe(module);
    expect(loadMdx).toHaveBeenLastCalledWith(reference);
  });
});
