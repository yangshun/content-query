import { defineMiddleware } from "void";
import { guides, type ContentGuide } from "content-query:collections/guides";

export type NavigationShared = {
  guideNavigation: ContentGuide<"id" | "title" | "section">[];
  isDocsPage: boolean;
};

/** Supplies the persistent docs layout independently of the current article loader. */
export default defineMiddleware(async (context, next) => {
  const guideNavigation = await guides.select("id", "title", "section").orderBy("order").all();
  const shared = context.get("shared");
  context.set("shared", {
    ...(shared !== null && typeof shared === "object" ? shared : {}),
    guideNavigation,
    isDocsPage: context.req.path.startsWith("/docs/"),
  });
  return next();
});
