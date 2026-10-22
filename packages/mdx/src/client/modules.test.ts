import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { loadReference, loadStyle } from "./modules.ts";

describe("native MDX module and stylesheet loading", () => {
  let window_: Window;
  const requests = new Map<string, (response: InstanceType<Window["Response"]>) => void>();
  beforeEach(() => {
    window_ = new Window({
      url: "https://example.com/docs/",
      settings: {
        fetch: {
          interceptor: {
            beforeAsyncRequest: ({ request }) =>
              new Promise((resolve) => {
                requests.set(request.url, resolve);
              }),
          },
        },
      },
    });
    vi.stubGlobal("document", window_.document);
  });
  afterEach(async () => {
    for (const resolve of requests.values()) {
      resolve(new window_.Response(""));
    }
    requests.clear();
    await window_.happyDOM.close();
    vi.unstubAllGlobals();
  });

  /** Completes a controlled browser resource fetch without making a network request. */
  async function respond(url: string, status = 200) {
    const absolute = new URL(url, document.baseURI).href;
    await vi.waitFor(() => expect(requests.has(absolute)).toBe(true));
    requests.get(absolute)!(
      new window_.Response("p{color:green}", { status, headers: { "content-type": "text/css" } }),
    );
    requests.delete(absolute);
  }

  test("shares pending styles, waits for load, and can reload after DOM removal", async () => {
    let loaded = false;
    const first = loadStyle("/shared.css").then(() => {
      loaded = true;
    });
    const second = loadStyle("https://example.com/shared.css");
    await Promise.resolve();
    expect(loaded).toBe(false);
    expect(document.querySelectorAll("link")).toHaveLength(1);
    await respond("/shared.css");
    await Promise.all([first, second]);
    expect(loaded).toBe(true);
    await loadStyle("/shared.css");
    expect(document.querySelectorAll("link")).toHaveLength(1);
    document.querySelector("link")!.remove();
    const reloaded = loadStyle("/shared.css");
    await respond("/shared.css");
    await reloaded;
  });

  test("removes failed styles and allows a later attempt", async () => {
    const pending = loadStyle("/retry.css");
    await Promise.all([
      expect(pending).rejects.toThrow("Could not load MDX stylesheet /retry.css"),
      respond("/retry.css", 500),
    ]);
    expect(document.querySelector("link")).toBeNull();
    const retry = loadStyle("/retry.css");
    await respond("/retry.css");
    await retry;
  });

  test("loads selected ESM after CSS and shares its module instance", async () => {
    const reference = {
      url: "data:text/javascript,export const value={answer:42}",
      css: ["/document.css"],
    };
    const first = loadReference<{ value: { answer: number } }>(reference);
    const second = loadReference<{ value: { answer: number } }>(reference);
    await respond("/document.css");
    const values = await Promise.all([first, second]);
    expect(values[0].value).toEqual({ answer: 42 });
    expect(values[0]).toBe(values[1]);
    await expect(
      loadReference({ url: 'data:text/javascript,throw new Error("module failed")', css: [] }),
    ).rejects.toThrow("module failed");
    await expect(
      loadReference({ url: 'data:text/javascript,throw new Error("module failed")', css: [] }),
    ).rejects.toThrow("module failed");
  });
});
