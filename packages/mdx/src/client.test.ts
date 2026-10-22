import { Window } from "happy-dom";
import { stringify } from "devalue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { mountIslands, loadMdx } from "./client.ts";
import { loadReference } from "./client/modules.ts";

vi.mock("./client/modules.ts", () => ({ loadReference: vi.fn(), loadStyle: vi.fn() }));

describe("island browser lifecycle", () => {
  let window_: Window;
  const cleanup = vi.fn();
  const mount = vi.fn((): (() => void) => cleanup);
  const disposers: (() => void)[] = [];

  beforeEach(() => {
    window_ = new Window();
    vi.stubGlobal("window", window_);
    vi.stubGlobal("document", window_.document);
    vi.stubGlobal("HTMLElement", window_.HTMLElement);
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.mocked(loadReference).mockReset().mockResolvedValue({ mount });
    mount.mockClear();
    cleanup.mockClear();
  });
  afterEach(async () => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    await window_.happyDOM.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Creates connected server-like markup without relying on implementation-generated snapshots. */
  function island(strategy = "load", url = "/widget.js") {
    const element = document.createElement("div");
    element.dataset.cqIsland = "widget";
    element.dataset.cqEntry = JSON.stringify({ url, css: [] });
    element.dataset.cqProps = stringify({ count: 2 });
    element.dataset.cqStrategy = strategy;
    element.dataset.cqPrefix = "unique-";
    document.body.append(element);
    return element;
  }

  test("mounts load/client-only roots once and cleans them up idempotently", async () => {
    const element = island("only");
    const dispose = mountIslands(element);
    disposers.push(dispose);
    expect(mountIslands(element)).toBe(dispose);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(mount).toHaveBeenCalledWith(
      element,
      { count: 2 },
      expect.objectContaining({ clientOnly: true, prefix: "unique-" }),
    );
    expect(element.dataset.cqMounted).toBe("true");
    dispose();
    dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  test("waits for visibility and cancels its observer", async () => {
    let observe: (entries: { isIntersecting: boolean }[]) => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof observe) {
          observe = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    island("visible");
    const dispose = mountIslands(document);
    disposers.push(dispose);
    expect(loadReference).not.toHaveBeenCalled();
    observe!([{ isIntersecting: false }]);
    expect(loadReference).not.toHaveBeenCalled();
    observe!([{ isIntersecting: true }]);
    observe!([{ isIntersecting: true }]);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    dispose();
    expect(disconnect).toHaveBeenCalled();
  });
  test("cancels immediately and defers root teardown when called during a host React commit", async () => {
    const element = island();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount.mockImplementationOnce(() => () => {
      cleanup();
      throw new Error("deferred cleanup failed");
    });
    const dispose = mountIslands(element, { deferUnmount: true });
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    dispose();
    expect(element.dataset.cqMounted).toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("cleanup failed"),
      expect.any(Error),
    );
  });
  test("prevents overlapping managers from mounting the same widget and allows remount after disposal", async () => {
    const element = island();
    const article = mountIslands(element);
    const page = mountIslands(document);
    disposers.push(article, page);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    article();
    page();
    disposers.push(mountIslands(document));
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
  });
  test("continues cleanup when one widget's disposer fails", async () => {
    island();
    island();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount.mockImplementationOnce(() => () => {
      throw new Error("cleanup failed");
    });
    const dispose = mountIslands(document);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    dispose();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("cleanup failed"),
      expect.objectContaining({ message: "cleanup failed" }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });
  test("ignores imports that finish after disposal or DOM removal", async () => {
    let finish: (value: unknown) => void;
    vi.mocked(loadReference).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const element = island();
    const dispose = mountIslands(document);
    dispose();
    element.remove();
    finish!({ mount });
    await Promise.resolve();
    expect(mount).not.toHaveBeenCalled();
    const removed = island();
    disposers.push(mountIslands(document));
    removed.remove();
    finish!({ mount });
    await Promise.resolve();
    expect(mount).not.toHaveBeenCalled();
  });
  test("uses idle scheduling after load and cancels pending work", async () => {
    const idle = vi.fn(() => 7);
    const cancel = vi.fn();
    Object.defineProperty(window_, "requestIdleCallback", { value: idle, configurable: true });
    Object.defineProperty(window_, "cancelIdleCallback", { value: cancel, configurable: true });
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    island("idle");
    const dispose = mountIslands(document);
    expect(idle).not.toHaveBeenCalled();
    window_.dispatchEvent(new window_.Event("load"));
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    dispose();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(loadReference).not.toHaveBeenCalled();
  });
  test("falls back to a cancellable timer when idle callbacks are unavailable", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    Object.defineProperty(window_, "requestIdleCallback", { value: undefined, configurable: true });
    const timeout = vi.spyOn(window, "setTimeout");
    island("idle");
    disposers.push(mountIslands(document));
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalled();
  });
  test("isolates errors and can report them through a host callback", async () => {
    island("load", "/broken.js");
    island("load", "/working.js");
    vi.mocked(loadReference).mockImplementation(async (reference) => {
      if (reference.url === "/broken.js") {
        throw new Error("network failed");
      }
      return { mount };
    });
    const onError = vi.fn();
    disposers.push(mountIslands(document, { onError }));
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "network failed" }),
        expect.any(window_.HTMLElement),
      ),
    );
    expect(mount).toHaveBeenCalledOnce();
  });
  test("reports malformed markers and exposes direct selected-document loading", async () => {
    const element = island();
    element.dataset.cqProps = "invalid";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    disposers.push(mountIslands(document));
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    const reference = { url: "/selected.js", css: [] };
    await loadMdx(reference);
    expect(loadReference).toHaveBeenLastCalledWith(reference);
  });
});
