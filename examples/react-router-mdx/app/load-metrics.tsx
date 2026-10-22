import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useOutletContext } from "react-router";

type Resource = Pick<
  PerformanceResourceTiming,
  "name" | "entryType" | "startTime" | "initiatorType" | "decodedBodySize" | "transferSize"
>;
type Sample = {
  route: string;
  scope: "page-load" | "navigation";
  resources: Resource[];
};
type Measurement = Sample | "unavailable" | null;

/** Totals observed response bodies and browser-reported transfers, without estimating bundle sizes. */
export function summarizeLoad(resources: readonly Resource[], documentUrl: string) {
  const scripts = resources.filter(
    (entry) =>
      entry.entryType === "resource" &&
      (entry.initiatorType === "script" ||
        entry.name === documentUrl ||
        /\.(?:[cm]?js|[jt]sx?)$/.test(new URL(entry.name).pathname)),
  );
  return {
    javascript: scripts.reduce((total, entry) => total + entry.decodedBodySize, 0),
    document: scripts
      .filter((entry) => entry.name === documentUrl)
      .reduce((total, entry) => total + entry.decodedBodySize, 0),
    transferred: resources.reduce((total, entry) => total + entry.transferSize, 0),
    requests: resources.length,
    cached: resources.filter((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0)
      .length,
  };
}

/** Tracks full loads and link/history navigation separately, including later deferred imports. */
export function useLoadMetrics(): Measurement {
  const { pathname, search } = useLocation();
  const route = pathname + search;
  const window_ = useRef({ route, scope: "page-load" as Sample["scope"], startTime: 0 });
  const pending = useRef<{ route: string; startTime: number } | null>(null);
  const resources = useRef(new Map<string, Resource>());
  const publish = useRef<(() => void) | null>(null);
  const [sample, setSample] = useState<Measurement>(null);

  useLayoutEffect(() => {
    if (window_.current.route !== route) {
      window_.current = {
        route,
        scope: "navigation",
        startTime: pending.current?.route === route ? pending.current.startTime : performance.now(),
      };
      pending.current = null;
      for (const [key, entry] of resources.current) {
        if (entry.startTime < window_.current.startTime) {
          resources.current.delete(key);
        }
      }
      publish.current?.();
    }
  }, [route]);

  useEffect(() => {
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes.includes("resource")
    ) {
      setSample("unavailable");
      return;
    }
    let active = true;
    publish.current = () => {
      if (active) {
        setSample({ ...window_.current, resources: [...resources.current.values()] });
      }
    };
    function ingest(entries: readonly PerformanceEntry[]) {
      if (!active) {
        return;
      }
      for (const entry of entries) {
        if (
          entry.startTime >= window_.current.startTime &&
          new URL(entry.name).origin === window.location.origin
        ) {
          resources.current.set(
            `${entry.entryType}:${entry.startTime}:${entry.name}`,
            entry as PerformanceResourceTiming,
          );
        }
      }
      publish.current?.();
    }
    function recordClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      ) {
        return;
      }
      const url = new URL(anchor.href);
      if (
        url.origin === window.location.origin &&
        url.pathname + url.search !== window_.current.route
      ) {
        pending.current = { route: url.pathname + url.search, startTime: performance.now() };
      }
    }
    function recordHistory() {
      pending.current = {
        route: window.location.pathname + window.location.search,
        startTime: performance.now(),
      };
    }
    function readNavigation() {
      ingest(performance.getEntriesByType("navigation"));
    }
    const observer = new PerformanceObserver((list) => ingest(list.getEntries()));
    observer.observe({ type: "resource", buffered: true });
    ingest([
      ...performance.getEntriesByType("navigation"),
      ...performance.getEntriesByType("resource"),
    ]);
    document.addEventListener("click", recordClick, true);
    window.addEventListener("popstate", recordHistory, true);
    window.addEventListener("load", readNavigation);
    return () => {
      active = false;
      publish.current = null;
      observer.disconnect();
      document.removeEventListener("click", recordClick, true);
      window.removeEventListener("popstate", recordHistory, true);
      window.removeEventListener("load", readNavigation);
    };
  }, []);

  return sample === "unavailable" || sample?.route === route ? sample : null;
}

/** Formats binary kibibytes while preserving small and zero byte counts. */
function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Shows observed browser transfers and optional rendered article bytes in expandable details. */
export function LoadMetrics({
  documentUrl,
  articleHtmlBytes,
}: {
  documentUrl: string;
  articleHtmlBytes?: number;
}) {
  const sample = useOutletContext<Measurement>();
  if (!sample || sample === "unavailable") {
    return (
      <p className="load-metrics">
        {sample === "unavailable" ? "Load measurements unavailable." : "Measuring load…"}
      </p>
    );
  }
  const metrics = summarizeLoad(sample.resources, new URL(documentUrl, window.location.href).href);
  return (
    <details
      className="load-metrics"
      data-scope={sample.scope}
      data-js-bytes={metrics.javascript}
      data-mdx-bytes={metrics.document}
      data-transfer-bytes={metrics.transferred}
      data-request-count={metrics.requests}
      data-article-html-bytes={articleHtmlBytes}
    >
      <summary>
        {import.meta.env.DEV ? "Dev · " : ""}
        {sample.scope === "page-load" ? "Full page load" : "Additional navigation load"}: JS{" "}
        <strong>{formatBytes(metrics.javascript)}</strong> · MDX entry{" "}
        <strong>{formatBytes(metrics.document)}</strong> · Transferred{" "}
        <strong>{formatBytes(metrics.transferred)}</strong>
      </summary>
      <p>
        {metrics.requests} resource loads, including {metrics.cached} local cache hits.{" "}
        {sample.scope === "page-load"
          ? "Includes HTML and the React Router application shell. A refresh can still use cached files."
          : "Only additional requests for this navigation. The application shell and previously imported modules are reused."}
      </p>
      {articleHtmlBytes !== undefined ? (
        <p>
          Rendered article HTML: <strong>{formatBytes(articleHtmlBytes)}</strong>. React Router also
          serializes this HTML in its hydration data. Full-page transfers include both copies;
          navigation sends route data only.
        </p>
      ) : null}
      <p>
        JS counts uncompressed script response bodies requested during this measurement. MDX entry
        counts only this document’s module, excluding its imports. Transferred includes same-origin
        HTML, data, scripts, styles, images, and estimated response headers. Cache hits can transfer
        zero bytes. Amounts depend on navigation history and browser caching. Compare modes using
        full page loads in separate fresh browser sessions.{" "}
        {import.meta.env.DEV
          ? "Development serves unbundled modules; compare production builds."
          : ""}
      </p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </details>
  );
}
