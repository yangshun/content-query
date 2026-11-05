import { defineMiddleware } from "void";
import { guides, type ContentGuide } from "content-query:collections/guides";

export type NavigationShared = {
  guideNavigation: ContentGuide<"id" | "title">[];
};

/** Supplies the persistent docs layout independently of the current article loader. */
export default defineMiddleware(async (context, next) => {
  if (context.req.path.startsWith("/docs/")) {
    const guideNavigation = await guides.select("id", "title").orderBy("order").all();
    const shared = context.get("shared");
    context.set("shared", {
      ...(shared !== null && typeof shared === "object" ? shared : {}),
      guideNavigation,
    });
  }
  return next();
});
