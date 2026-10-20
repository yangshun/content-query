import type { StandardSchemaV1 } from "@standard-schema/spec";
import getReadingTime from "reading-time";
import { schema } from "../schema.ts";
import type { ComputedContext } from "../collection/types.ts";
import type { MaybePromise } from "../shared/types.ts";
import { assertServerOnly } from "../shared/server-only.ts";
import { plainText } from "./plain-text.ts";

assertServerOnly();

/** The syntax removed before computing text-derived fields; literal text preserves all characters. */
export type TextFormat = "markdown" | "text" | "html";

/** Selects text from validated entry data or loader metadata instead of the captured body. */
export type TextOptions<Data = Record<string, unknown>, Source = unknown> = {
  /** Defaults to readBody(); undefined text is treated as an empty string. Async selectors are supported. */
  from?: (context: ComputedContext<Data, Source>) => MaybePromise<string | undefined>;
  /** Input syntax, defaulting to markdown. */
  format?: TextFormat;
};

/** Controls the reading-speed estimate in addition to selecting its input text. */
export type ReadingTimeOptions<Data = Record<string, unknown>, Source = unknown> = TextOptions<
  Data,
  Source
> & {
  /** A finite positive reading speed, defaulting to 200 words per minute. */
  wordsPerMinute?: number;
};

/** Controls the maximum excerpt size in addition to selecting its input text. */
export type ExcerptOptions<Data = Record<string, unknown>, Source = unknown> = TextOptions<
  Data,
  Source
> & {
  /** A positive integer, defaulting to 160. Counts graphemes and includes the trailing ellipsis. */
  maxLength?: number;
};

/** Binds a typed result schema and text operation to the existing computed-field resolver contract. */
function textField<Data, Source, Value>(
  schema: StandardSchemaV1<unknown, Value>,
  options: TextOptions<Data, Source>,
  compute: (text: string) => Value,
) {
  const { from, format = "markdown" } = options;
  if (!["markdown", "text", "html"].includes(format)) {
    throw new TypeError('Text format must be "markdown", "text", or "html".');
  }
  if (from !== undefined && typeof from !== "function") {
    throw new TypeError("Text from must be a function.");
  }
  return {
    schema,
    /** Resolves selected text during preparation and honors cancellation around asynchronous input. */
    async resolve(context: ComputedContext<Data, Source>): Promise<Value> {
      context.signal.throwIfAborted();
      const input = await (from ? from(context) : context.readBody());
      context.signal.throwIfAborted();
      if (input !== undefined && typeof input !== "string") {
        throw new TypeError("Computed text input must be a string or undefined.");
      }
      return compute(plainText(input ?? "", format));
    },
  };
}

/** Creates a numeric computed field counting normalized text with reading-time's word boundaries. */
export function wordCount<Data = Record<string, unknown>, Source = unknown>(
  options: TextOptions<Data, Source> = {},
) {
  return textField(
    schema.number().int().nonnegative(),
    options,
    (text) => getReadingTime(text).words,
  );
}

/** Creates a numeric computed field estimating whole reading minutes, rounded up; empty text returns zero. */
export function readingTime<Data = Record<string, unknown>, Source = unknown>(
  options: ReadingTimeOptions<Data, Source> = {},
) {
  const { wordsPerMinute = 200 } = options;
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) {
    throw new TypeError("wordsPerMinute must be a finite positive number.");
  }
  return textField(schema.number().int().nonnegative(), options, (text) =>
    Math.ceil(getReadingTime(text, { wordsPerMinute }).minutes),
  );
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Truncates at a word boundary where possible, preserving complete Unicode graphemes and the hard limit. */
function truncate(text: string, maxLength: number): string {
  const characters: string[] = [];
  for (const { segment } of graphemes.segment(text)) {
    characters.push(segment);
    if (characters.length > maxLength) {
      break;
    }
  }
  if (characters.length <= maxLength) {
    return text;
  }
  const prefix = characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd();
  const boundary = prefix.lastIndexOf(" ");
  const complete =
    characters[maxLength - 1] === " " || boundary < 0 ? prefix : prefix.slice(0, boundary);
  return `${complete}…`;
}

/** Creates a string computed field containing a normalized plain-text excerpt with a bounded length. */
export function excerpt<Data = Record<string, unknown>, Source = unknown>(
  options: ExcerptOptions<Data, Source> = {},
) {
  const { maxLength = 160 } = options;
  if (!Number.isSafeInteger(maxLength) || maxLength <= 0) {
    throw new TypeError("maxLength must be a positive safe integer.");
  }
  return textField(schema.string(), options, (text) => truncate(text, maxLength));
}
