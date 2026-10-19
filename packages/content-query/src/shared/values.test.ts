import { describe, expect, test } from "vite-plus/test";
import { valuePath } from "./values.ts";

describe("valuePath", () => {
  test("parses property, index, quoted, and Map key segments", () => {
    expect(valuePath(".tags[0]")).toEqual(["tags", 0]);
    expect(valuePath('["two words"].inner')).toEqual(["two words", "inner"]);
    expect(valuePath('.map.get("key").value')).toEqual(["map", "key", "value"]);
    expect(valuePath(".map.get(2)")).toEqual(["map", 2]);
    expect(valuePath(".map.get(...)")).toEqual(["map", "..."]);
    expect(valuePath('[".get(\\"x\\")"]')).toEqual(['.get("x")']);
  });
  test("keeps unrecognized text whole instead of guessing", () => {
    expect(valuePath("not a path")).toEqual(["not a path"]);
    expect(valuePath(".ok junk")).toEqual([".ok junk"]);
  });
});
