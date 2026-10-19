type ContentClickEvent = Pick<
  MouseEvent,
  | "defaultPrevented"
  | "button"
  | "metaKey"
  | "ctrlKey"
  | "shiftKey"
  | "altKey"
  | "target"
  | "preventDefault"
>;

/** Sends ordinary internal Markdown link clicks through the host router. */
export function navigateContentLink(
  event: ContentClickEvent,
  navigate: (href: string) => unknown,
): void {
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
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.hasAttribute("download") ||
    (anchor.target && anchor.target !== "_self")
  ) {
    return;
  }
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) {
    return;
  }
  const url = new URL(anchor.href);
  if (
    url.origin !== window.location.origin ||
    (url.pathname === window.location.pathname && url.search === window.location.search && url.hash)
  ) {
    return;
  }
  event.preventDefault();
  void navigate(`${url.pathname}${url.search}${url.hash}`);
}
