import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as entry from "../schema.ts";
import { schema } from "../schema.ts";

describe("schema builders", () => {
  test("exposes only the selected namespace and content builders", () => {
    expect(Object.keys(entry)).toEqual(["schema"]);
    expect(Object.keys(schema).sort()).toEqual(
      [
        "object",
        "string",
        "number",
        "boolean",
        "bigint",
        "date",
        "array",
        "enum",
        "literal",
        "union",
        "record",
        "unknown",
        "coerce",
      ].sort(),
    );
    expect(Object.keys(schema.coerce).sort()).toEqual([
      "bigint",
      "boolean",
      "date",
      "number",
      "string",
    ]);
  });

  test.each([
    ["object", schema.object({ title: schema.string() }), { title: "Post" }],
    ["string", schema.string(), "Post"],
    ["number", schema.number(), 12],
    ["boolean", schema.boolean(), true],
    ["bigint", schema.bigint(), 12n],
    ["date", schema.date(), new Date("2026-01-01")],
    ["array", schema.array(schema.string()), ["content"]],
    ["enum", schema.enum(["draft", "published"]), "published"],
    ["literal", schema.literal("published"), "published"],
    ["union", schema.union([schema.string(), schema.number()]), 12],
    ["record", schema.record(schema.string(), schema.number()), { views: 12 }],
    ["unknown", schema.unknown(), { arbitrary: true }],
  ] as const)("%s produces a Standard Schema validator", async (_name, validator, value) => {
    expect(validator["~standard"].version).toBe(1);
    expect(await validator["~standard"].validate(value)).toEqual({ value });
  });

  test.each([
    ["string", schema.coerce.string(), 12, "12"],
    ["number", schema.coerce.number(), "12", 12],
    ["boolean", schema.coerce.boolean(), 1, true],
    ["bigint", schema.coerce.bigint(), "12", 12n],
    ["date", schema.coerce.date(), "2026-01-01", new Date("2026-01-01")],
  ] as const)("coerces %s values", async (_name, validator, value, expected) => {
    expect(await validator["~standard"].validate(value)).toEqual({ value: expected });
  });

  test("preserves optional fields, defaults, refinements, transforms, and object composition", async () => {
    const metadata = schema
      .object({
        title: schema.string().trim().min(1),
        description: schema.string().nullable().optional(),
        draft: schema.boolean().default(false),
      })
      .extend({
        slug: schema.string().refine((value) => !value.includes(" ")),
        length: schema.string().transform((value) => value.length),
      });

    expect(
      await metadata["~standard"].validate({ title: " Post ", slug: "hello", length: "hello" }),
    ).toEqual({ value: { title: "Post", draft: false, slug: "hello", length: 5 } });
    expect(
      (await metadata["~standard"].validate({ title: "", slug: "has spaces" })).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["title"] }),
        expect.objectContaining({ path: ["slug"] }),
      ]),
    );
  });

  test("supports asynchronous refinements and transforms through Standard Schema", async () => {
    const validator = schema
      .string()
      .refine(async (value) => value.length > 0, "A title is required.")
      .transform(async (value) => value.toUpperCase());

    expect(await validator["~standard"].validate("Post")).toEqual({ value: "POST" });
    expect((await validator["~standard"].validate("")).issues).toEqual([
      expect.objectContaining({ message: "A title is required." }),
    ]);
  });
});

describe("schema inference", () => {
  test("distinguishes inputs from defaulted and transformed outputs", () => {
    const metadata = schema.object({
      length: schema.string().transform((value) => value.length),
      description: schema.string().optional(),
      draft: schema.boolean().default(false),
    });

    expectTypeOf<schema.input<typeof metadata>>().toEqualTypeOf<{
      length: string;
      description?: string | undefined;
      draft?: boolean | undefined;
    }>();
    expectTypeOf<schema.output<typeof metadata>>().toEqualTypeOf<{
      length: number;
      description?: string | undefined;
      draft: boolean;
    }>();
    expectTypeOf<schema.infer<typeof metadata>>().toEqualTypeOf<schema.output<typeof metadata>>();
  });

  test("infers inputs and outputs from a different Standard Schema provider", () => {
    const validator: StandardSchemaV1<string, number> = {
      "~standard": {
        version: 1,
        vendor: "fixture",
        validate: (value) => ({ value: Number(value) }),
      },
    };

    expectTypeOf<schema.input<typeof validator>>().toEqualTypeOf<string>();
    expectTypeOf<schema.output<typeof validator>>().toEqualTypeOf<number>();
    expectTypeOf<schema.infer<typeof validator>>().toEqualTypeOf<number>();

    // @ts-expect-error Provider-level parsing utilities are not part of the builder namespace.
    void schema.parse;
    // @ts-expect-error Provider error classes are not part of the builder namespace.
    void schema.ZodError;
    // @ts-expect-error Provider configuration is not part of the builder namespace.
    void schema.config;
  });
});
