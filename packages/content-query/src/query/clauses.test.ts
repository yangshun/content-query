import { describe, expect, test } from "vite-plus/test";
import { checkedPayload, checkedPayloads } from "./clauses.ts";
import type { QueryRegistry } from "./plan.ts";

const registry: QueryRegistry = {
  exercises: {
    relationships: {},
    payloads: {
      _body: { variants: [] },
      detail: { variants: ["locale", "language"] },
    },
  },
  settings: { relationships: {} },
};

describe("checkedPayload", () => {
  test("accepts payloads without variants and sorts variant keys", () => {
    expect(checkedPayload(registry, "exercises", "_body", true)).toEqual({ variant: {} });
    expect(checkedPayload(registry, "exercises", "_body", undefined)).toEqual({ variant: {} });
    const detail = checkedPayload(registry, "exercises", "detail", {
      locale: "en-US",
      language: "python",
    });
    expect(detail).toEqual({ variant: { language: "python", locale: "en-US" } });
    expect(Object.keys(detail.variant)).toEqual(["language", "locale"]);
  });
  test("rejects unknown names, missing variants, and malformed variant keys", () => {
    expect(() => checkedPayload(registry, "settings", "_body", true)).toThrow(
      /Unknown payload "_body"/,
    );
    expect(() => checkedPayload(registry, "exercises", "detail", true)).toThrow(
      /requires variant keys: locale, language/,
    );
    for (const variant of [
      { locale: "en-US" },
      { locale: "en-US", language: 1 },
      { locale: "en-US", language: "python", extra: "x" },
      ["en-US"],
      null,
    ]) {
      expect(() => checkedPayload(registry, "exercises", "detail", variant)).toThrow(
        /exactly these string variant keys: locale, language/,
      );
    }
    expect(() => checkedPayload(registry, "exercises", "_body", { locale: "en-US" })).toThrow(
      /exactly these string variant keys: none/,
    );
  });
});

describe("checkedPayloads", () => {
  test("omits false payloads but still checks their names", () => {
    expect(checkedPayloads(registry, "exercises", { _body: false })).toBeUndefined();
    expect(checkedPayloads(registry, "exercises", { _body: true, detail: false })).toEqual({
      _body: { variant: {} },
    });
    expect(() => checkedPayloads(registry, "exercises", { missing: false })).toThrow(
      /Unknown payload "missing"/,
    );
  });
});
