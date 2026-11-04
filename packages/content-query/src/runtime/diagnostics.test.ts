import { describe, expect, test } from "vite-plus/test";
import { ContentError, groupDiagnostics, payloadIdentity } from "../shared/errors.ts";
import { restoreContentError, serializeContentError } from "./diagnostics.ts";

describe("serializeContentError", () => {
  test("keeps payload and variant context through the development transport", () => {
    const error = groupDiagnostics([
      {
        code: "validation-error",
        operation: "build",
        collection: "coding",
        id: "two-sum",
        source: "two-sum/exercise.json",
        payload: "detail",
        variant: { locale: "fr-FR" },
        path: ["hints", 0],
        message: "Payload detail[locale=fr-FR] failed.",
        cause: new Error("Missing translation"),
      },
      { code: "validation-error", collection: "coding", message: "Second failure" },
    ]);
    const restored = restoreContentError(serializeContentError(error));
    expect(restored).toBeInstanceOf(ContentError);
    expect(restored).toMatchObject({
      code: "validation-error",
      payload: "detail",
      variant: { locale: "fr-FR" },
      path: ["hints", 0],
    });
    expect(restored.diagnostics).toHaveLength(2);
    expect(restored.diagnostics[0]).toMatchObject({
      payload: "detail",
      variant: { locale: "fr-FR" },
      cause: expect.objectContaining({ message: "Missing translation" }),
    });
  });
});

describe("payloadIdentity", () => {
  test("lists variant pairs in sorted key order", () => {
    expect(payloadIdentity("detail")).toBe("detail");
    expect(payloadIdentity("detail", {})).toBe("detail");
    expect(payloadIdentity("detail", { locale: "en-US", level: "easy" })).toBe(
      "detail[level=easy,locale=en-US]",
    );
  });
});
