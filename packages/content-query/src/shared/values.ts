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

/** Detaches an entire selected graph, including aliases across selected properties. */
export function detach<Value>(value: Value): Value {
  return decode<Value>(encode(value));
}

/** Clones selected values together while defining requested property names safely. */
export function detachSelection(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(detach(new Map(Object.entries(record))));
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
