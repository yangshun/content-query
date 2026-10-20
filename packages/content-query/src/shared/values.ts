import { parse, stringify } from "devalue";

/** Encodes supported values without reducers, preserving presence and graph references. */
export function encode(value: unknown): string {
  return stringify(value);
}

// Map segments come first: a property segment is never followed by "(".
const pathSegment =
  /^(?:\.get\(("(?:[^"\\]|\\.)*"|[^)]*)\)|\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\])/;

/**
 * Converts devalue's formatted error path, such as `.tags[0]` or `.map.get("key")`, into
 * property segments. Map entries are identified by their key; unparsable text is kept whole.
 */
export function valuePath(formatted: string): PropertyKey[] {
  const segments: PropertyKey[] = [];
  let rest = formatted;
  while (rest) {
    const match = pathSegment.exec(rest);
    if (!match) {
      return [formatted];
    }
    const [text, mapKey, identifier, index, quoted] = match;
    if (identifier !== undefined) {
      segments.push(identifier);
    } else if (index !== undefined) {
      segments.push(Number(index));
    } else if (quoted !== undefined) {
      segments.push(JSON.parse(quoted) as string);
    } else {
      const key = mapKey!;
      segments.push(
        key.startsWith('"')
          ? (JSON.parse(key) as string)
          : /^-?\d+(?:\.\d+)?$/.test(key)
            ? Number(key)
            : key,
      );
    }
    rest = rest.slice(text.length);
  }
  return segments;
}

/** Restores supported values without invoking application schemas or transforms. */
export function decode<Value = unknown>(encoded: string): Value {
  return parse(encoded) as Value;
}

/** Reads the built-in tag that the encoder uses to choose a value's encoding. */
function tagOf(value: object): string {
  return Object.prototype.toString.call(value);
}

/** Marks a graph that only the general encode/decode round trip can detach faithfully. */
const general = Symbol("general");

/**
 * Copies a graph of primitives, plain or null-prototype objects, dense arrays, and dates
 * directly. Each object must pass the same tag, thenable, symbol-key, and `__proto__` checks
 * that the encoder applies; objects and dates also need their standard prototype. The encoder
 * reads any array-tagged value by index, so array subclasses and arrays from other realms
 * copy into ordinary arrays either way. Anything else returns `general` so the caller detaches
 * the whole graph through devalue, which keeps aliases consistent across rich values and
 * reports unsupported values with their paths.
 */
function copyDirect(value: unknown, copies: Map<object, unknown>): unknown {
  if (typeof value !== "object" || value === null) {
    return typeof value === "function" || typeof value === "symbol" ? general : value;
  }
  const existing = copies.get(value);
  if (existing !== undefined) {
    return existing;
  }
  if (typeof (value as { then?: unknown }).then === "function") {
    return general;
  }
  const tag = tagOf(value);
  if (tag === "[object Array]") {
    const source = value as readonly unknown[];
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (let index = 0; index < source.length; index++) {
      const item = source[index];
      if (item === undefined && !Object.hasOwn(source, index)) {
        return general;
      }
      const copied = copyDirect(item, copies);
      if (copied === general) {
        return general;
      }
      copy.push(copied);
    }
    return copy;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (tag === "[object Object]" && (prototype === Object.prototype || prototype === null)) {
    if (Object.getOwnPropertySymbols(value).length) {
      return general;
    }
    const source = value as Record<string, unknown>;
    const copy: Record<string, unknown> = prototype === null ? Object.create(null) : {};
    copies.set(value, copy);
    for (const key of Object.keys(source)) {
      if (key === "__proto__") {
        return general;
      }
      const copied = copyDirect(source[key], copies);
      if (copied === general) {
        return general;
      }
      copy[key] = copied;
    }
    return copy;
  }
  if (tag === "[object Date]" && prototype === Date.prototype) {
    const copy = new Date((value as Date).getTime());
    copies.set(value, copy);
    return copy;
  }
  return general;
}

/**
 * Detaches an entire value graph with the supported-value semantics, preserving cycles and
 * repeated references. Graphs of primitives, plain objects, dense arrays, and dates are copied
 * directly; any other graph, including one containing a `Map`, an array hole, or an unsupported
 * value, takes the devalue encode/decode round trip as a whole, which throws for unsupported
 * values. Getters on a graph that falls back can therefore be read twice.
 *
 * @param value - The value to copy; it is never modified.
 * @returns An independent copy that callers can mutate without affecting `value`.
 */
export function detach<Value>(value: Value): Value {
  const copied = copyDirect(value, new Map());
  return copied === general ? decode<Value>(encode(value)) : (copied as Value);
}

/**
 * Detaches the named fields of one record together, so references shared between selected
 * fields remain shared in the result. Every name becomes an own enumerable property, including
 * `__proto__`, and missing fields become own `undefined` values. Each field is read once.
 *
 * @param record - The stored record to read; it is never modified.
 * @param fields - The selected field names, in result order.
 * @returns A new object containing detached copies of the selected values.
 */
export function detachSelection(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const values = fields.map((field) => (Object.hasOwn(record, field) ? record[field] : undefined));
  const copies = new Map<object, unknown>();
  const selection: Record<string, unknown> = {};
  for (let index = 0; index < fields.length; index++) {
    const copied = copyDirect(values[index], copies);
    if (copied === general) {
      return Object.fromEntries(
        decode<Map<string, unknown>>(
          encode(new Map(fields.map((field, position) => [field, values[position]]))),
        ),
      );
    }
    const field = fields[index]!;
    if (field === "__proto__") {
      Object.defineProperty(selection, field, {
        value: copied,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      selection[field] = copied;
    }
  }
  return selection;
}

/** Compares strings by Unicode code point rather than locale or UTF-16 code unit. */
export function compareStrings(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index]! < rightPoints[index]! ? -1 : 1;
    }
  }
  return Math.sign(leftPoints.length - rightPoints.length);
}

/** Tests the scalar categories accepted by equality and relationship matching. */
export function isScalar(
  value: unknown,
): value is string | number | bigint | boolean | Date | null | undefined {
  return (
    value == null ||
    ["string", "number", "bigint", "boolean"].includes(typeof value) ||
    value instanceof Date
  );
}

/** Applies scalar equality with date timestamps and SameValueZero numeric behavior. */
export function equal(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && equal(left.getTime(), right.getTime());
  }
  return (
    left === right ||
    (typeof left === "number" &&
      typeof right === "number" &&
      Number.isNaN(left) &&
      Number.isNaN(right))
  );
}

/** Orders comparable scalar values; undefined denotes incomparable values. */
export function compare(left: unknown, right: unknown): number | undefined {
  if (left == null || right == null) {
    return undefined;
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date
      ? compare(left.getTime(), right.getTime())
      : undefined;
  }
  if (typeof left !== typeof right) {
    return undefined;
  }
  if (typeof left === "string" && typeof right === "string") {
    return compareStrings(left, right);
  }
  if (
    (typeof left === "number" && typeof right === "number") ||
    (typeof left === "bigint" && typeof right === "bigint") ||
    (typeof left === "boolean" && typeof right === "boolean")
  ) {
    if (typeof left === "number" && (Number.isNaN(left) || Number.isNaN(right))) {
      return undefined;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return undefined;
}
