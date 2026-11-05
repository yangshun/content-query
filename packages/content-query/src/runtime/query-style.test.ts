import { describe, expect, test } from "vite-plus/test";
import {
  isQueryStyle,
  queryStyleDisabledMessage,
  queryStyleMembers,
  styleOfMember,
  type QueryStyleDisabled,
} from "./query-style.ts";

describe("isQueryStyle", () => {
  test("accepts only the supported styles", () => {
    expect(isQueryStyle("fluent")).toBe(true);
    expect(isQueryStyle("relational")).toBe(true);
    for (const value of [
      "sql",
      "Fluent",
      "",
      undefined,
      null,
      1,
      ["fluent"],
      { style: "fluent" },
    ]) {
      expect(isQueryStyle(value)).toBe(false);
    }
  });
});

describe("styleOfMember", () => {
  test("maps every gated collection member to the style that owns it", () => {
    for (const [style, members] of Object.entries(queryStyleMembers)) {
      for (const member of members) {
        expect(styleOfMember(member)).toBe(style);
      }
    }
  });

  test("gives each style a distinct set of collection members", () => {
    const members = Object.values(queryStyleMembers).flat();
    expect(new Set(members).size).toBe(members.length);
  });
});

describe("queryStyleDisabledMessage", () => {
  test("names the collection, the disabled member, and the configured style", () => {
    const message: QueryStyleDisabled<"posts", "select", "relational"> = queryStyleDisabledMessage(
      "posts",
      "select",
      "relational",
    );
    expect(message).toBe(
      'posts.select is unavailable because content-query.config sets queryStyle to "relational".',
    );
    expect(queryStyleDisabledMessage("posts", "count(options)", "fluent")).toBe(
      'posts.count(options) is unavailable because content-query.config sets queryStyle to "fluent".',
    );
  });
});
