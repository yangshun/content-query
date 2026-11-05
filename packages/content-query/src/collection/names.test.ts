import { describe, expect, test } from "vite-plus/test";
import { collectionNames, exportNameOf, singularOf } from "./names.ts";

describe("exportNameOf", () => {
  test("keeps identifier names", () => {
    for (const name of ["posts", "blogPosts", "_drafts", "$cache", "v2"]) {
      expect(exportNameOf(name)).toBe(name);
    }
  });

  test("joins words around characters that identifiers cannot contain", () => {
    expect(exportNameOf("blog-posts")).toBe("blogPosts");
    expect(exportNameOf("docs.v2")).toBe("docsV2");
    expect(exportNameOf("release notes/2026")).toBe("releaseNotes2026");
    expect(exportNameOf("-leading")).toBe("leading");
  });

  test("prefixes a leading digit and suffixes reserved and device names", () => {
    expect(exportNameOf("2026-posts")).toBe("_2026Posts");
    expect(exportNameOf("default")).toBe("defaultCollection");
    expect(exportNameOf("class")).toBe("classCollection");
    expect(exportNameOf("con")).toBe("conCollection");
    expect(exportNameOf("LPT1")).toBe("LPT1Collection");
    expect(exportNameOf("---")).toBe("collection");
  });
});

describe("singularOf", () => {
  test("drops one trailing s, except after another s", () => {
    expect(singularOf("jobs")).toBe("job");
    expect(singularOf("projectsTracks")).toBe("projectsTrack");
    expect(singularOf("addresses")).toBe("addresse");
    expect(singularOf("address")).toBe("address");
    expect(singularOf("interviewsListingBottomContent")).toBe("interviewsListingBottomContent");
    expect(singularOf("s")).toBe("s");
  });
});

describe("collectionNames", () => {
  test("derives export, entry type, and payload type names", () => {
    expect(
      Object.fromEntries(
        collectionNames({
          jobs: {},
          "blog-posts": {},
          categories: { typeName: "Category" },
          series: { typeName: "series" },
        }),
      ),
    ).toEqual({
      jobs: { exportName: "jobs", typeName: "ContentJob", payloadTypeName: "ContentJobPayload" },
      "blog-posts": {
        exportName: "blogPosts",
        typeName: "ContentBlogPost",
        payloadTypeName: "ContentBlogPostPayload",
      },
      categories: {
        exportName: "categories",
        typeName: "ContentCategory",
        payloadTypeName: "ContentCategoryPayload",
      },
      series: {
        exportName: "series",
        typeName: "ContentSeries",
        payloadTypeName: "ContentSeriesPayload",
      },
    });
  });

  test("rejects export names that collide, ignoring letter case", () => {
    expect(() => collectionNames({ "blog-posts": {}, blogPosts: {} })).toThrow(
      /"blog-posts" and "blogPosts" both export "blogPosts"/,
    );
    expect(() => collectionNames({ posts: {}, Posts: {} })).toThrow(/ignoring letter case/);
  });

  test("rejects generated type names that collide", () => {
    expect(() => collectionNames({ job: {}, jobs: {} })).toThrow(
      /"job" and "jobs" both generate the type "ContentJob". Set typeName/,
    );
    expect(() => collectionNames({ jobs: {}, jobPayloads: {} })).toThrow(
      /both generate the type "ContentJobPayload"/,
    );
    expect(() => collectionNames({ jobs: {}, roles: { typeName: "Job" } })).toThrow(/ContentJob/);
  });

  test("rejects a typeName that is not an identifier", () => {
    for (const typeName of ["", "Blog Post", "1st", 3]) {
      expect(() => collectionNames({ posts: { typeName } })).toThrow(
        /Collection "posts" typeName must be an identifier/,
      );
    }
  });
});
