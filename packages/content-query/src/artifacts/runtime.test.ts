import { describe, expect, test } from "vite-plus/test";
import { encode } from "../shared/values.ts";
import { createArtifactCollection, createArtifactRevision } from "./runtime.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type ArtifactManifest } from "./types.ts";

/** A manifest that lists the given collections without relationships or payloads. */
function manifest(...names: string[]): ArtifactManifest {
  return {
    version: ARTIFACT_VERSION,
    codec: CODEC_VERSION,
    collections: Object.fromEntries(names.map((name) => [name, { relationships: {} }])),
  };
}

describe("createArtifactRevision", () => {
  test("decodes a generated collection module once for every entry that imports it", () => {
    const posts = { records: [encode({ id: "one", title: "One" })], builtins: {} };
    const first = createArtifactRevision(manifest("posts"), { posts });
    const second = createArtifactRevision(manifest("posts"), { posts });
    expect(second.collections.posts!.records).toBe(first.collections.posts!.records);
    expect(second.collections.posts!.builtins).toBe(first.collections.posts!.builtins);
    const copy = createArtifactRevision(manifest("posts"), { posts: { ...posts } });
    expect(copy.collections.posts!.records).not.toBe(first.collections.posts!.records);
  });

  test("rejects missing collection modules and invalid records", () => {
    expect(() => createArtifactRevision(manifest("posts"), {})).toThrow(
      expect.objectContaining({
        code: "artifact-error",
        cause: expect.objectContaining({ message: 'Missing collection artifact "posts".' }),
      }),
    );
    for (const records of [
      [encode({ title: "No ID" })],
      [encode({ id: "one" }), encode({ id: "one" })],
      [encode({ id: "one", _payloads: {} })],
    ]) {
      expect(() =>
        createArtifactRevision(manifest("posts"), { posts: { records, builtins: {} } }),
      ).toThrow(
        expect.objectContaining({
          code: "artifact-error",
          cause: expect.objectContaining({
            message: 'Invalid query records for collection "posts".',
          }),
        }),
      );
    }
  });
});

describe("createArtifactCollection", () => {
  test("rejects an entry whose manifest does not list its collection", () => {
    expect(() =>
      createArtifactCollection(manifest(), "posts", { records: [], builtins: {} }),
    ).toThrow(
      expect.objectContaining({
        code: "artifact-error",
        message: 'Missing collection artifact "posts".',
      }),
    );
  });

  test("queries the entry's collection", async () => {
    const posts = createArtifactCollection<
      { posts: { loader: never; relationships: {} } },
      "posts"
    >(manifest("posts"), "posts", {
      records: [encode({ id: "one", title: "One" })],
      builtins: {},
    });
    expect(await posts.count()).toBe(1);
  });
});
