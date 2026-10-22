import { Window } from "happy-dom";
import {
  act,
  StrictMode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { stringify } from "devalue";
import { MdxDocument, MdxIslands } from "../react.ts";
import { prepareMdxDocument } from "./server.ts";
import { mountReactIsland } from "./client.ts";
import { loadReference } from "../client/modules.ts";

vi.mock("react", async (loadOriginal) => {
  const react = await loadOriginal<typeof import("react")>();
  return { ...react, createElement: vi.fn(react.createElement) };
});
vi.mock("../client/modules.ts", () => ({ loadReference: vi.fn(), loadStyle: vi.fn() }));

describe("MDX in a host React application", () => {
  let window_: Window;
  beforeEach(() => {
    window_ = new Window();
    vi.stubGlobal("window", window_);
    vi.stubGlobal("document", window_.document);
    vi.stubGlobal("HTMLElement", window_.HTMLElement);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(createElement).mockClear();
    vi.mocked(loadReference).mockReset();
  });
  afterEach(async () => {
    await window_.happyDOM.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("renders server-loaded and browser-loaded documents in the surrounding provider", async () => {
    const context = createContext("unprovided");
    /** Reads the application provider from the document's own component subtree. */
    function Content() {
      return createElement("p", null, useContext(context));
    }
    const module = { default: Content, headings: [] };
    const reference = { url: "/host-document.js", css: ["/host.css"] };
    const selected = prepareMdxDocument(reference, module);
    selected.css.push("/detached.css");
    expect(reference.css).toEqual(["/host.css"]);
    const html = renderToString(
      createElement(
        context.Provider,
        { value: "server" },
        createElement(MdxDocument, { reference }),
      ),
    );
    expect(html).toContain("<p>server</p>");
    expect(html).toContain('href="/host.css"');
    expect(loadReference).not.toHaveBeenCalled();
    vi.mocked(loadReference).mockResolvedValueOnce(module);
    const container = document.createElement("main");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          context.Provider,
          { value: "browser" },
          createElement(MdxDocument, {
            reference: { url: "/browser-document.js", css: [] },
            fallback: "Loading",
          }),
        ),
      ),
    );
    expect(container.textContent).toBe("browser");
    expect(loadReference).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  test("uses compact keys that preserve unchanged HTML and reset each content revision", async () => {
    const html = `<p>${"A long article. ".repeat(200)}</p>`;
    const container = document.createElement("main");
    document.body.append(container);
    const root = createRoot(container);

    /** Observes the real React elements without depending on React's private Fiber fields. */
    function articleKey() {
      const keys = vi
        .mocked(createElement)
        .mock.calls.flatMap(([, props]) =>
          props && "html" in props && props.key !== undefined && props.key !== null
            ? [props.key]
            : [],
        );
      expect(keys.length).toBeGreaterThan(0);
      return keys.at(-1);
    }

    try {
      await act(async () => root.render(createElement(MdxIslands, { html })));
      const firstKey = articleKey();
      const firstContainer = container.firstElementChild;
      expect(String(firstKey).length).toBeLessThan(32);

      await act(async () => root.render(createElement(MdxIslands, { html, className: "updated" })));
      expect(articleKey()).toBe(firstKey);
      expect(container.firstElementChild).toBe(firstContainer);

      await act(async () =>
        root.render(createElement(MdxIslands, { html: `${html}<p>Edited article</p>` })),
      );
      const editedKey = articleKey();
      expect(editedKey).not.toBe(firstKey);
      expect(String(editedKey).length).toBeLessThan(32);
      expect(container.firstElementChild).not.toBe(firstContainer);
      expect(container.textContent).toContain("Edited article");

      await act(async () => root.render(createElement(MdxIslands, { html })));
      expect(articleKey()).not.toBe(editedKey);
      expect(String(articleKey()).length).toBeLessThan(32);
      expect(container.textContent).not.toContain("Edited article");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("mounts once under StrictMode, preserves widgets on host updates, and disposes during navigation", async () => {
    const cleanup = vi.fn();
    /** Exercises a real independent root while the host commits and removes its article. */
    function Widget() {
      const [count, setCount] = useState(0);
      useEffect(() => cleanup, []);
      return createElement("button", { onClick: () => setCount((value) => value + 1) }, count);
    }
    const html = `<div data-cq-island="counter" data-cq-entry='${JSON.stringify({ url: "/counter.js", css: [] })}' data-cq-props='${stringify({})}' data-cq-strategy="load" data-cq-prefix="counter-">${renderToString(createElement(Widget))}</div>`;
    const mount = vi.fn(
      (
        element: HTMLElement,
        props: Record<string, unknown>,
        options: Parameters<typeof mountReactIsland>[3],
      ) => mountReactIsland(element, Widget, props, options),
    );
    vi.mocked(loadReference).mockResolvedValue({ mount });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("main");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(MdxIslands, { html }))),
    );
    expect(mount).toHaveBeenCalledOnce();
    await act(async () => container.querySelector("button")!.click());
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(MdxIslands, { html, onIslandError: vi.fn() }),
        ),
      ),
    );
    expect(container.textContent).toBe("1");
    expect(mount).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(MdxIslands, { html: `<p>Edited article</p>${html}` }),
        ),
      ),
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(container.querySelector("button")!.textContent).toBe("0");
    await act(async () =>
      root.render(
        createElement(StrictMode, null, createElement(MdxIslands, { html: "<p>Next article</p>" })),
      ),
    );
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("Next article");
    expect(errors).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  test("reports individual widget failures without removing static prose", async () => {
    const html = '<p>Readable prose</p><div data-cq-island="broken" data-cq-entry="invalid"></div>';
    const report = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("main");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(MdxIslands, { html, onIslandError: report })));
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.any(HTMLElement));
    expect(container.textContent).toBe("Readable prose");
    await act(async () =>
      root.render(createElement(MdxIslands, { html: `${html}<p>Another article</p>` })),
    );
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("initialization failed"),
      expect.any(Error),
    );
    await act(async () => root.unmount());
  });
});
