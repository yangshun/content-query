import { defineMiddleware } from "void";
import { content, type CollectionData } from "content-query:server";

export type NavigationShared = {
  guideNavigation: Pick<CollectionData<"guides">, "id" | "title">[];
};

/** Supplies the persistent docs layout independently of the current article loader. */
export default defineMiddleware(async (context, next) => {
  if (context.req.path.startsWith("/docs/")) {
    const guideNavigation = await content
      .select("id", "title")
      .from("guides")
      .orderBy("order")
      .all();
    const shared = context.get("shared");
    context.set("shared", {
      ...(shared !== null && typeof shared === "object" ? shared : {}),
      guideNavigation,
    });
  }
  return next();
});
