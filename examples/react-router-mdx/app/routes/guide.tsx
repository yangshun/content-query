import { type MouseEvent } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { content } from "content-query:server";
import { eq } from "content-query/query";
import { loadMdxDocument, renderMdx, getMdxAssets } from "content-query:mdx:server";
import { MdxDocument, MdxIslands } from "@content-query/mdx/react";
import { LoadMetrics } from "../load-metrics";

export async function loader({ params }: LoaderFunctionArgs) {
  const { mode, slug = "" } = params;

  if (mode !== "islands" && mode !== "react") {
    throw new Response("Unknown rendering mode", { status: 404 });
  }

  const guides = await content
    .select("id", "title", "description")
    .from("guides")
    .orderBy("order")
    .all();
  const guide = await content
    .select("id", "title", "description")
    .from("guides")
    .where((fields) => eq(fields.id, slug))
    .first();

  if (!guide) {
    throw new Response("Guide not found", { status: 404 });
  }

  const assets = await getMdxAssets();
  const document =
    mode === "islands"
      ? {
          mode: "islands" as const,
          ...(await renderMdx("guides", slug)),
        }
      : { mode: "react" as const, reference: await loadMdxDocument("guides", slug) };

  const articleHtmlBytes =
    document.mode === "islands" ? new TextEncoder().encode(document.html).byteLength : undefined;
  return {
    guides,
    guide,
    document,
    articleHtmlBytes,
    documentUrl: assets.document("guides", slug).url,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  {
    title: loaderData
      ? `${loaderData.guide.title} | ContentQuery`
      : "Guide not found | ContentQuery",
  },
  { name: "description", content: loaderData?.guide.description ?? "" },
];

export default function GuidePage() {
  const { guides, guide, document, articleHtmlBytes, documentUrl } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const mode = document.mode;

  function preventActiveModeNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.currentTarget.getAttribute("aria-current") === "page"
    ) {
      event.preventDefault();
    }
  }

  function followContentLink(event: MouseEvent<HTMLElement>) {
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
    const anchor = (event.target as Element).closest("a");
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    ) {
      return;
    }
    const url = new URL(anchor.href);
    if (
      url.origin !== location.origin ||
      (url.pathname === location.pathname && url.search === location.search)
    ) {
      return;
    }
    event.preventDefault();
    void navigate(`${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <main className="docs-layout" id="article" tabIndex={-1} onClick={followContentLink}>
      <nav className="guide-nav" aria-label="Guides">
        <h2>Guides</h2>
        <ul>
          {guides.map((item) => (
            <li key={item.id}>
              <Link
                to={`/${mode}/docs/${item.id}`}
                aria-current={item.id === guide.id ? "page" : undefined}
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <nav className="mode-bar" aria-label="Rendering mode">
          <span>Mode</span>
          <div className="mode-toggle">
            <Link
              to={`/islands/docs/${guide.id}`}
              aria-current={mode === "islands" ? "page" : undefined}
              onClick={preventActiveModeNavigation}
            >
              Islands
            </Link>
            <Link
              to={`/react/docs/${guide.id}`}
              aria-current={mode === "react" ? "page" : undefined}
              onClick={preventActiveModeNavigation}
            >
              React
            </Link>
          </div>
        </nav>
        <LoadMetrics documentUrl={documentUrl} articleHtmlBytes={articleHtmlBytes} />
        <article>
          {document.mode === "islands" ? (
            <MdxIslands html={document.html} styles={document.styles} />
          ) : (
            <MdxDocument reference={document.reference} />
          )}
        </article>
        <p>
          <Link to="/">All guides</Link>
        </p>
      </div>
    </main>
  );
}
