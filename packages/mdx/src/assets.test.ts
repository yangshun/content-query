import { describe, expect, test } from "vite-plus/test";
import { createMdxAssets } from "./assets.ts";
import { documentKey, type MdxAssetManifest } from "./types.ts";

describe("createMdxAssets", () => {
  test("resolves selected entries and detaches all returned arrays", () => {
    const manifest: MdxAssetManifest = {
      version: 1,
      documents: {
        [documentKey("guides", "__proto__")]: {
          client: { url: "/doc.js", css: ["/doc.css"] },
          css: ["/static.css"],
        },
      },
      islands: { quiz: { url: "/quiz.js", css: ["/quiz.css"] } },
      assets: [],
    };
    const assets = createMdxAssets(manifest);
    expect(assets.document("guides", "__proto__")).toEqual({ url: "/doc.js", css: ["/doc.css"] });
    expect(assets.styles("guides", "__proto__")).toEqual(["/static.css"]);
    assets.document("guides", "__proto__").css.push("mutated");
    assets.island("quiz").css.push("mutated");
    assets.styles("guides", "__proto__").push("mutated");
    expect(assets.island("quiz").css).toEqual(["/quiz.css"]);
    expect(assets.document("guides", "__proto__").css).toEqual(["/doc.css"]);
    expect(assets.styles("guides", "__proto__")).toEqual(["/static.css"]);
    expect(() => assets.document("guides", "missing")).toThrow("No browser entry");
    expect(() => assets.island("__proto__")).toThrow("No browser entry");
    expect(() => assets.styles("guides", "missing")).toThrow("Unknown MDX");
  });
  test("rejects incompatible versions and document access in islands-only builds", () => {
    expect(() => createMdxAssets({ version: 2 } as unknown as MdxAssetManifest)).toThrow("version");
    const assets = createMdxAssets({
      version: 1,
      documents: { [documentKey("posts", "one")]: { css: [] } },
      islands: {},
      assets: [],
    });
    expect(() => assets.document("posts", "one")).toThrow("enable");
  });
});
