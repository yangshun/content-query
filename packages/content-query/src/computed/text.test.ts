import { describe, expect, test, vi } from "vite-plus/test";
import type { ComputedContext } from "../collection/types.ts";
import { excerpt, readingTime, wordCount, type TextOptions } from "../computed.ts";

/** Creates a resolver context with captured body text and a typed structured-data field. */
function context(body?: string): ComputedContext<{ description: string }, { key: string }> {
  return {
    collection: "posts",
    id: "one",
    data: { description: "Selected description" },
    source: { key: "source-key" },
    readBody: vi.fn(async () => body),
    signal: new AbortController().signal,
  };
}

describe("wordCount", () => {
  test("counts captured Markdown text without link URLs or markup", async () => {
    expect(
      await wordCount().resolve(
        context("# Hello\n\nRead **this** [guide](https://example.com/extra/words)."),
      ),
    ).toBe(4);
  });

  test("uses HTML text and reading-time's CJK boundaries", async () => {
    expect(
      await wordCount({ format: "html" }).resolve(
        context("<p>Hello world</p><script>skip these words</script>"),
      ),
    ).toBe(2);
    expect(await wordCount({ format: "text" }).resolve(context("你好世界"))).toBe(4);
  });

  test("treats absent bodies and selected optional text as empty", async () => {
    expect(await wordCount().resolve(context())).toBe(0);
    expect(await wordCount({ from: () => undefined }).resolve(context("Ignored body"))).toBe(0);
  });

  test("awaits input selectors without reading the body", async () => {
    const current = context("Ignored body");
    const field = wordCount<{ description: string }, { key: string }>({
      from: async ({ data, source }) => `${data.description} ${source?.key}`,
      format: "text",
    });
    expect(await field.resolve(current)).toBe(3);
    expect(current.readBody).not.toHaveBeenCalled();
  });
});

describe("readingTime", () => {
  test.each([
    [0, 0],
    [1, 1],
    [200, 1],
    [201, 2],
    [400, 2],
  ])("rounds %i words up to %i whole minutes", async (words, minutes) => {
    expect(await readingTime().resolve(context("word ".repeat(words)))).toBe(minutes);
  });

  test("supports a custom reading speed", async () => {
    expect(await readingTime({ wordsPerMinute: 100 }).resolve(context("word ".repeat(201)))).toBe(
      3,
    );
  });

  test.each([0, -1, NaN, Infinity, -Infinity])(
    "rejects invalid reading speed %s at declaration time",
    (wordsPerMinute) => {
      expect(() => readingTime({ wordsPerMinute })).toThrow(
        "wordsPerMinute must be a finite positive number",
      );
    },
  );
});

describe("excerpt", () => {
  test("returns normalized plain text when the whole input fits", async () => {
    expect(
      await excerpt().resolve(context("# Hello\n\nA **short** [article](https://example.com).")),
    ).toBe("Hello A short article.");
    expect(await excerpt().resolve(context())).toBe("");
  });

  test.each([
    ["hello world again", 12, "hello world…"],
    ["hello world again", 9, "hello…"],
    ["supercalifragilistic", 5, "supe…"],
    ["hello", 5, "hello"],
    ["hello", 1, "…"],
    ["👨‍👩‍👧‍👦e\u0301x", 2, "👨‍👩‍👧‍👦…"],
    ["e\u0301xyz", 2, "e\u0301…"],
  ] as const)("limits %s to %i graphemes", async (body, maxLength, expected) => {
    expect(await excerpt({ maxLength, format: "text" }).resolve(context(body))).toBe(expected);
  });

  test("defaults to at most 160 graphemes including its ellipsis", async () => {
    const result = await excerpt().resolve(context("word ".repeat(100)));
    expect(result.endsWith("…")).toBe(true);
    expect(
      Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(result)),
    ).toHaveLength(160);
  });

  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maximum length %s",
    (maxLength) => {
      expect(() => excerpt({ maxLength })).toThrow("maxLength must be a positive safe integer");
    },
  );
});

describe("computed text input contract", () => {
  test("rejects invalid formats and selectors at declaration time", () => {
    expect(() => wordCount({ format: "xml" } as unknown as TextOptions)).toThrow(
      "Text format must be",
    );
    expect(() => excerpt({ from: "description" } as unknown as TextOptions)).toThrow(
      "Text from must be a function",
    );
  });

  test("rejects selected values that are not text", async () => {
    // @ts-expect-error Selectors must return text or undefined.
    const field = wordCount({ from: () => 42 });
    await expect(field.resolve(context())).rejects.toThrow(
      "Computed text input must be a string or undefined",
    );
  });

  test("preserves input failures", async () => {
    const failure = new Error("Input unavailable");
    const field = excerpt({
      from: async () => {
        throw failure;
      },
    });
    await expect(field.resolve(context())).rejects.toBe(failure);
  });

  test("honors cancellation before and after asynchronous selection", async () => {
    const controller = new AbortController();
    const current = { ...context("Body"), signal: controller.signal };
    controller.abort();
    await expect(wordCount().resolve(current)).rejects.toMatchObject({ name: "AbortError" });
    expect(current.readBody).not.toHaveBeenCalled();

    const pending = new AbortController();
    const field = wordCount({
      from: async () => {
        pending.abort();
        return "Late value";
      },
    });
    await expect(field.resolve({ ...context(), signal: pending.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("supplies Standard Schema result validation", async () => {
    expect(await wordCount().schema["~standard"].validate(2)).toEqual({ value: 2 });
    expect((await readingTime().schema["~standard"].validate(-1)).issues).toBeDefined();
    expect(await excerpt().schema["~standard"].validate("Excerpt")).toEqual({ value: "Excerpt" });
  });
});
