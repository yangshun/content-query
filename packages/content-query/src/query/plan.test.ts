import { describe, expect, test } from "vite-plus/test";
import { emptyPlan, hasSelection, NO_SELECTION_MESSAGE, type QueryPlan } from "./plan.ts";

/** Builds a plan over one collection with the given overrides. */
function plan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return { ...emptyPlan("posts"), ...overrides };
}

describe("hasSelection", () => {
  test("rejects scopes that request nothing, including filtered and empty selections", () => {
    expect(hasSelection(undefined)).toBe(false);
    expect(hasSelection(plan())).toBe(false);
    expect(hasSelection(plan({ select: [] }))).toBe(false);
    expect(hasSelection(plan({ payloads: {} }))).toBe(false);
    expect(
      hasSelection(
        plan({ filters: [{ kind: "predicate", operator: "eq", field: "id", value: "a" }] }),
      ),
    ).toBe(false);
  });

  test("accepts fields, relationships, payloads, or adjacency on their own", () => {
    expect(hasSelection(plan({ select: ["title"] }))).toBe(true);
    expect(hasSelection(plan({ with: { author: plan({ select: ["name"] }) } }))).toBe(true);
    expect(hasSelection(plan({ select: [], payloads: { _rendered: { variant: {} } } }))).toBe(true);
    expect(
      hasSelection(plan({ adjacent: { scope: "results", plan: plan({ select: ["id"] }) } })),
    ).toBe(true);
  });
});

describe("NO_SELECTION_MESSAGE", () => {
  test("names every kind of data a scope can select", () => {
    expect(NO_SELECTION_MESSAGE).toMatch(/fields, relationships, payloads, or adjacent entries/);
  });
});
