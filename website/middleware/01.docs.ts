import { defineMiddleware } from "void";
import { content, type CollectionData } from "content-query:server";

export type NavigationShared = {
  guideNavigation: Pick<CollectionData<"guides">, "id" | "title" | "section">[];
  isDocsPage: boolean;
};

/** Supplies the persistent docs layout independently of the current article loader. */
export default defineMiddleware(async (context, next) => {
  const guideNavigation = await content
    .select("id", "title", "section")
    .from("guides")
    .orderBy("order")
    .all();
  const shared = context.get("shared");
  context.set("shared", {
    ...(shared !== null && typeof shared === "object" ? shared : {}),
    guideNavigation,
    isDocsPage: context.req.path.startsWith("/docs/"),
  });
  return next();
});
