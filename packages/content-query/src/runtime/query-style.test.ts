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
  test("maps every gated root member to the style that owns it", () => {
    for (const [style, members] of Object.entries(queryStyleMembers)) {
      for (const member of members) {
        expect(styleOfMember(member)).toBe(style);
      }
    }
  });

  test("gives each style a distinct set of root members", () => {
    const members = Object.values(queryStyleMembers).flat();
    expect(new Set(members).size).toBe(members.length);
  });
});

describe("queryStyleDisabledMessage", () => {
  test("names the disabled member and the configured style", () => {
    const message: QueryStyleDisabled<"from", "relational"> = queryStyleDisabledMessage(
      "from",
      "relational",
    );
    expect(message).toBe(
      'content.from is unavailable because content-query.config sets queryStyle to "relational".',
    );
    expect(queryStyleDisabledMessage("count", "fluent")).toBe(
      'content.count is unavailable because content-query.config sets queryStyle to "fluent".',
    );
  });
});
