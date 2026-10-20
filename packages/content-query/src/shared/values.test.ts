import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { decode, detach, detachSelection, encode, valuePath } from "./values.ts";

/** Runs the general encode/decode round trip, capturing its result or rejection. */
function roundTrip(value: unknown): { value: unknown } | { error: Error & { path?: string } } {
  try {
    return { value: decode(encode(value)) };
  } catch (error) {
    return { error: error as Error & { path?: string } };
  }
}

/** Asserts that detach() returns or throws exactly what the general round trip does. */
function expectGeneralParity(value: unknown): unknown {
  const expected = roundTrip(value);
  if ("error" in expected) {
    let thrown: (Error & { path?: string }) | undefined;
    try {
      detach(value);
    } catch (error) {
      thrown = error as Error & { path?: string };
    }
    expect(thrown?.message).toBe(expected.error.message);
    expect(thrown?.path).toBe(expected.error.path);
    return undefined;
  }
  const copied = detach(value);
  expect(copied).toStrictEqual(expected.value);
  return copied;
}

class Custom {
  value = 1;
}

/** Builds an array of the given length with holes everywhere except the supplied indexes. */
function withHoles<Item>(length: number, entries: Record<number, Item> = {}): Item[] {
  const array: Item[] = [];
  array.length = length;
  return Object.assign(array, entries);
}

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

describe("detach", () => {
  test("copies plain graphs into independent values with special primitives intact", () => {
    const source = {
      title: "Title",
      html: '<p> "quoted" \ud800 text</p>',
      numbers: [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0],
      big: 10n,
      flags: [true, false, null, undefined],
      optional: undefined,
      date: new Date(1),
      invalid: new Date(Number.NaN),
      headings: [{ depth: 2, slug: "intro", text: "Intro" }],
    };
    const copied = expectGeneralParity(source) as typeof source;
    expect(Object.is(copied.numbers[4], -0)).toBe(true);
    expect(Object.hasOwn(copied, "optional")).toBe(true);
    expect(copied.headings).not.toBe(source.headings);
    expect(copied.date).not.toBe(source.date);
    expect(copied.date.getTime()).toBe(1);
    expect(Number.isNaN(copied.invalid.getTime())).toBe(true);
    copied.headings[0]!.text = "Changed";
    copied.headings.push({ depth: 3, slug: "added", text: "Added" });
    copied.date.setTime(2);
    copied.numbers.length = 0;
    expect(source.headings).toEqual([{ depth: 2, slug: "intro", text: "Intro" }]);
    expect(source.date.getTime()).toBe(1);
    expect(source.numbers).toHaveLength(5);
  });

  test("returns primitive roots and rejects function or symbol roots", () => {
    expect(detach("text")).toBe("text");
    expect(detach(undefined)).toBeUndefined();
    expect(Object.is(detach(-0), -0)).toBe(true);
    expectGeneralParity(() => 1);
    expectGeneralParity(Symbol("value"));
  });

  test("preserves repeated and circular references within one graph", () => {
    const shared = { label: "shared" };
    const source: Record<string, unknown> = { left: shared, right: shared, list: [shared, shared] };
    source.self = source;
    const copied = detach(source) as typeof source & {
      left: typeof shared;
      list: (typeof shared)[];
    };
    expect(copied).not.toBe(source);
    expect(copied.self).toBe(copied);
    expect(copied.left).not.toBe(shared);
    expect(copied.right).toBe(copied.left);
    expect(copied.list[0]).toBe(copied.left);
    expect(copied.list[1]).toBe(copied.left);
    copied.left.label = "changed";
    expect(shared.label).toBe("shared");
  });

  test("detaches rich graphs as a whole so aliases survive across rich values", () => {
    const shared = { label: "shared" };
    const source = {
      plain: shared,
      map: new Map([["key", shared]]),
      set: new Set([shared]),
      pattern: /a+/giu,
      url: new URL("https://example.com/a?b=c"),
      params: new URLSearchParams("a=1&b=2"),
      bytes: new Uint8Array([1, 2, 3]),
      boxed: Object("text") as string,
      holes: withHoles(3, { 0: 1, 2: 3 }),
      sparse: withHoles(1_000, { 999: "last" }),
      empty: Object.assign(Object.create(null) as object, { constructor: "own" }),
    };
    const copied = expectGeneralParity(source) as typeof source;
    expect(copied.map.get("key")).toBe(copied.plain);
    expect([...copied.set][0]).toBe(copied.plain);
    expect(copied.plain).not.toBe(shared);
    expect(Object.hasOwn(copied.holes, 1)).toBe(false);
    expect(Object.getPrototypeOf(copied.empty)).toBeNull();
    copied.map.get("key")!.label = "changed";
    expect(shared.label).toBe("shared");
  });

  test("matches the general path at direct-copy boundaries", () => {
    class Items extends Array<number> {}
    class Moment extends Date {}
    class Shifted extends Date {
      override toISOString() {
        return "2000-01-01T00:00:00.000Z";
      }
    }
    // oxlint-disable-next-line unicorn/no-thenable
    const withThen = Object.assign([1], { then: () => undefined });
    const tagged = { [Symbol.toStringTag]: "Array", length: 1, 0: "zero" };
    const taggedArray = Object.assign([1], { [Symbol.toStringTag]: "Custom" });
    const hiddenSymbol = Object.defineProperty({ visible: 1 }, Symbol("hidden"), { value: 2 });
    const withGetter = {
      get computed() {
        return { value: 1 };
      },
    };
    const extra = Object.assign([1, 2], { label: "ignored" });
    for (const value of [
      Items.from([1, 2]),
      new Moment(5),
      new Shifted(5),
      Object.create(Array.prototype) as unknown,
      Object.create(Date.prototype) as unknown,
      Object.setPrototypeOf([1, 2], Object.prototype) as unknown,
      Object.setPrototypeOf(new Date(1), Object.prototype) as unknown,
      withThen,
      // oxlint-disable-next-line unicorn/no-thenable
      { then: () => undefined },
      Promise.resolve(1),
      tagged,
      taggedArray,
      hiddenSymbol,
      withGetter,
      extra,
      new Custom(),
      runInNewContext("({ nested: { list: [1, 2] } })") as unknown,
      runInNewContext("[{ value: 1 }]") as unknown,
      runInNewContext("new Date(3)") as unknown,
      [undefined, undefined],
    ]) {
      expectGeneralParity(value);
    }
    expect(detach(new Shifted(5)).toISOString()).toBe("2000-01-01T00:00:00.000Z");
    expect(detach([undefined])).toEqual([undefined]);
    expect(Object.hasOwn(detach([undefined]), 0)).toBe(true);
  });

  test("keeps array holes in otherwise plain graphs", () => {
    const holes = withHoles(3, { 0: 1, 2: 3 });
    for (const value of [holes, { nested: { holes } }, [withHoles(1_000), "after"]]) {
      expectGeneralParity(value);
    }
    const copied = detach({ nested: { holes } });
    expect(copied.nested.holes).toHaveLength(3);
    expect(Object.hasOwn(copied.nested.holes, 1)).toBe(false);
  });

  test("copies prototype-like keys as own data properties", () => {
    const source = {
      constructor: "constructor",
      toString: "toString",
      hasOwnProperty: 1,
      prototype: { valueOf: 2 },
      nested: Object.assign(Object.create(null) as Record<string, unknown>, { constructor: 3 }),
    };
    const copied = expectGeneralParity(source) as typeof source;
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    expect(Object.keys(copied)).toEqual(Object.keys(source));
    expect(Object.hasOwn(copied, "constructor")).toBe(true);
    expect(copied.prototype).toEqual({ valueOf: 2 });
    expect(Object.getPrototypeOf(copied.nested)).toBeNull();
    expect(copied.nested.constructor).toBe(3);
  });

  test("rejects unsupported shapes with the general path's messages and paths", () => {
    const protoKey = JSON.parse('{"__proto__": 1}') as unknown;
    for (const value of [
      { nested: { list: [1, () => 2] } },
      { value: Symbol("value") },
      { [Symbol("key")]: 1 },
      { nested: protoKey },
      Object.assign(Object.create(null) as object, { nested: protoKey }),
      Object.assign(Object.create(null) as object, protoKey),
      { instance: new Custom() },
      { pending: Promise.resolve(1) },
    ]) {
      expectGeneralParity(value);
    }
    expect(() => detach({ nested: { list: [1, () => 2] } })).toThrow(
      expect.objectContaining({ path: ".nested.list[1]" }),
    );
  });
});

describe("detachSelection", () => {
  test("defines selected, prototype-like, and missing names as own properties", () => {
    const record = Object.defineProperty({ id: "one", constructor: "own" }, "__proto__", {
      value: "stored",
      enumerable: true,
    });
    const selected = detachSelection(record, ["id", "constructor", "__proto__", "missing"]);
    expect(Object.getPrototypeOf(selected)).toBe(Object.prototype);
    expect(Object.keys(selected)).toEqual(["id", "constructor", "__proto__", "missing"]);
    expect(Reflect.get(selected, "__proto__")).toBe("stored");
    expect(selected.constructor).toBe("own");
    expect(Object.hasOwn(selected, "missing")).toBe(true);
    expect(selected.missing).toBeUndefined();
    const inherited = detachSelection({ id: "one" }, ["toString", "__proto__"]);
    expect(Object.hasOwn(inherited, "toString")).toBe(true);
    expect(Reflect.get(inherited, "toString")).toBeUndefined();
    expect(Reflect.get(inherited, "__proto__")).toBeUndefined();
  });

  test("keeps references shared across selected fields and isolates mutations", () => {
    const shared = { label: "shared" };
    const record = { id: "one", primary: shared, list: [shared], unselected: shared };
    const selected = detachSelection(record, ["primary", "list"]) as {
      primary: typeof shared;
      list: (typeof shared)[];
    };
    expect(selected.primary).not.toBe(shared);
    expect(selected.list[0]).toBe(selected.primary);
    expect(Object.hasOwn(selected, "unselected")).toBe(false);
    selected.primary.label = "changed";
    selected.list.push({ label: "added" });
    expect(record).toEqual({ id: "one", primary: shared, list: [shared], unselected: shared });
    expect(shared.label).toBe("shared");
  });

  test("detaches every field through the general path when any field is rich", () => {
    const shared = { label: "shared" };
    const record = Object.defineProperty(
      { id: "one", plain: shared, map: new Map([["key", shared]]) },
      "__proto__",
      { value: [shared], enumerable: true },
    );
    const selected = detachSelection(record, ["plain", "__proto__", "map", "missing"]) as {
      plain: typeof shared;
      map: Map<string, typeof shared>;
    };
    expect(Object.keys(selected)).toEqual(["plain", "__proto__", "map", "missing"]);
    expect(Object.getPrototypeOf(selected)).toBe(Object.prototype);
    expect(selected.map.get("key")).toBe(selected.plain);
    expect((Reflect.get(selected, "__proto__") as unknown[])[0]).toBe(selected.plain);
    expect(Object.hasOwn(selected, "missing")).toBe(true);
    selected.map.get("key")!.label = "changed";
    expect(shared.label).toBe("shared");
    expect(() => detachSelection({ id: "one", value: [() => 1] }, ["value"])).toThrow(
      expect.objectContaining({ message: "Cannot stringify a function", path: '.get("value")[0]' }),
    );
  });

  test("reads each selected field once on both paths", () => {
    let reads = 0;
    const record = {
      id: "one",
      get plain() {
        reads++;
        return { value: 1 };
      },
      get rich() {
        reads++;
        return new Set([1]);
      },
    };
    expect(detachSelection(record, ["plain"])).toEqual({ plain: { value: 1 } });
    expect(reads).toBe(1);
    reads = 0;
    expect(detachSelection(record, ["plain", "rich"])).toEqual({
      plain: { value: 1 },
      rich: new Set([1]),
    });
    expect(reads).toBe(2);
  });
});
