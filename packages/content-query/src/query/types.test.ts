import { describe, expectTypeOf, test } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import { schema } from "../schema.ts";
import type { AllCollections } from "../../tests/helpers/collections.ts";

const loader = { name: "fixture", async load() {} };
const document = { schema: schema.string().nullable(), resolve: () => null };

/** A challenge collection shaped like a real catalog: many kinds of fields and five payloads. */
const challenges = defineCollection({
  loader,
  schema: schema.object({
    access: schema.enum(["free", "standard", "premium"]),
    baseCredits: schema.number().default(1),
    coverImage: schema.string(),
    createdAt: schema.coerce.date(),
    difficulty: schema.enum(["starter", "mid", "senior", "nightmare"]),
    galleryImages: schema.array(schema.string()),
    guides: schema.array(schema.enum(["figma", "git", "forms"])),
    hasStarterAndDesignFiles: schema.boolean().default(true),
    order: schema.number(),
    pointsForSkillGroups: schema.record(schema.string(), schema.number()),
    preReqs: schema.array(schema.string()).default([]),
    resources: schema.array(schema.enum(["starter-code", "style-guide", "api"])),
    solutionFrameworkDefault: schema.enum(["react", "vanilla"]).optional(),
    specImages: schema.record(
      schema.string(),
      schema.array(
        schema.object({
          images: schema.object({ desktop: schema.string(), mobile: schema.string() }),
          label: schema.string(),
        }),
      ),
    ),
    specLabels: schema.record(schema.string(), schema.string()),
    specShowGridLayoutButton: schema.boolean().default(true),
  }),
  payloads: {
    apiWriteup: document,
    appendix: document,
    brief: document,
    guide: document,
    styleGuide: document,
  },
});
const registry = { challenges };
type Content = AllCollections<typeof registry>;
type Documents<Name extends string> = { [Key in Name]: string | null };

describe("fluent query result types", () => {
  test("infers a multi-field, multi-payload query awaited inside Promise.all", () => {
    /** Checks inference only; the queries never run. */
    async function check(content: Content) {
      const [count, challenge, listed, first] = await Promise.all([
        Promise.resolve(1),
        content.challenges
          .byId("blog-card")
          .select(
            "access",
            "hasStarterAndDesignFiles",
            "id",
            "resources",
            "specImages",
            "specLabels",
            "specShowGridLayoutButton",
          )
          .withPayload("styleGuide")
          .withPayload("apiWriteup")
          .withPayload("appendix"),
        content.challenges
          .select("id", "access", "specImages")
          .withPayload("brief")
          .withPayload("guide")
          .withPayload("appendix"),
        content.challenges
          .byId("blog-card")
          .select("id", "specLabels")
          .withPayload("styleGuide")
          .withPayload("apiWriteup")
          .first(),
      ]);
      expectTypeOf(count).toEqualTypeOf<number>();
      expectTypeOf(challenge?.access).toEqualTypeOf<"free" | "standard" | "premium" | undefined>();
      expectTypeOf(challenge?.specLabels).toEqualTypeOf<Record<string, string> | undefined>();
      expectTypeOf(challenge?._payloads).toEqualTypeOf<
        Documents<"styleGuide" | "apiWriteup" | "appendix"> | undefined
      >();
      expectTypeOf(listed[0]!._payloads).toEqualTypeOf<Documents<"brief" | "guide" | "appendix">>();
      // Rows read as one flat object, with every requested payload under one `_payloads`.
      expectTypeOf(first).toEqualTypeOf<
        | {
            id: string;
            specLabels: Record<string, string>;
            _payloads: { styleGuide: string | null; apiWriteup: string | null };
          }
        | undefined
      >();
    }
    void check;
  });
});
