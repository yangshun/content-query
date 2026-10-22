import { Window } from "happy-dom";
import {
  act,
  Component,
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createClientOnly } from "./react.ts";
import { mountReactIsland } from "./react/client.ts";

describe("React rendering boundaries", () => {
  let window_: Window;
  beforeEach(() => {
    window_ = new Window();
    vi.stubGlobal("window", window_);
    vi.stubGlobal("document", window_.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => {
    await window_.happyDOM.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("loads client-only components after mount inside their parent's provider", async () => {
    const theme = createContext("unprovided");
    const load = vi.fn(async () => BrowserWidget);
    const ClientOnly = createClientOnly(load);
    /** Reads the host's context from a browser-only subtree. */
    function BrowserWidget(props: Record<string, unknown>) {
      return createElement("span", null, useContext(theme), ": ", String(props.label));
    }
    expect(renderToString(createElement(ClientOnly, { label: "Widget" }))).toBe("");
    expect(load).not.toHaveBeenCalled();
    const container = document.createElement("main");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          theme.Provider,
          { value: "shared" },
          createElement(ClientOnly, { label: "Widget" }),
        ),
      );
    });
    expect(container.textContent).toBe("shared: Widget");
    expect(load).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  test("ignores client-only imports and rejections that finish after cleanup", async () => {
    let resolve: (component: () => null) => void;
    let reject: (cause: Error) => void;
    const load = () =>
      new Promise<() => null>((done, fail) => {
        resolve = done;
        reject = fail;
      });
    const ClientOnly = createClientOnly(load);
    const container = document.createElement("main");
    const root = createRoot(container);
    await act(async () => root.render(createElement(ClientOnly)));
    await act(async () => root.unmount());
    await act(async () => resolve!(() => null));
    const second = createRoot(container);
    await act(async () => second.render(createElement(ClientOnly)));
    await act(async () => second.unmount());
    await act(async () => reject!(new Error("late rejection")));
    expect(container.textContent).toBe("");
  });

  test("surfaces a failed client-only import through the host React error boundary", async () => {
    const failure = new Error("Unavailable widget");
    const ClientOnly = createClientOnly(async () => {
      throw failure;
    });
    const caught = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(cause: unknown) {
        caught(cause);
      }
      render() {
        return this.state.failed ? "Widget unavailable" : this.props.children;
      }
    }
    const container = document.createElement("main");
    const root = createRoot(container);
    await act(async () =>
      root.render(createElement(Boundary, { children: createElement(ClientOnly) })),
    );
    expect(container.textContent).toBe("Widget unavailable");
    expect(caught).toHaveBeenCalledWith(failure);
    await act(async () => root.unmount());
  });

  test("hydrates with matching useId prefixes, handles interaction, and cleans effects up", async () => {
    const cleanup = vi.fn();
    /** Exercises identity, local state, event binding, and effect lifetime across SSR and hydration. */
    function Widget() {
      const id = useId();
      const [count, setCount] = useState(0);
      useEffect(() => cleanup, []);
      return createElement("button", { id, onClick: () => setCount((value) => value + 1) }, count);
    }
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(Widget), { identifierPrefix: "same-" });
    const originalId = container.querySelector("button")!.id;
    const onError = vi.fn();
    let dispose: () => void;
    await act(async () => {
      dispose = mountReactIsland(
        container,
        Widget,
        {},
        { clientOnly: false, prefix: "same-", onError },
      );
    });
    expect(container.querySelector("button")!.id).toBe(originalId);
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toBe("1");
    expect(onError).not.toHaveBeenCalled();
    await act(async () => dispose!());
    expect(cleanup).toHaveBeenCalledOnce();
    expect(container.childNodes).toHaveLength(0);
  });

  test("creates a client-only root without expecting server markup", async () => {
    const container = document.createElement("div");
    let dispose: () => void;
    await act(async () => {
      dispose = mountReactIsland(
        container,
        () => createElement("p", null, "Browser only"),
        {},
        { clientOnly: true, prefix: "only-", onError: vi.fn() },
      );
    });
    expect(container.textContent).toBe("Browser only");
    await act(async () => dispose!());
    expect(container.childNodes).toHaveLength(0);
  });
});
