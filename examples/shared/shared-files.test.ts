import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

const styles = [
  "../void/src/styles.css",
  "../next/app/styles.css",
  "../react-router/app/styles.css",
  "../tanstack-start/src/styles.css",
  "../sveltekit/src/app.css",
];
const navigation = [
  "../void/src/navigation.ts",
  "../next/app/navigation.ts",
  "../react-router/app/navigation.ts",
  "../tanstack-start/src/navigation.ts",
];
const testUtilities = [
  "../react-router/tests/test-utils.ts",
  "../tanstack-start/tests/test-utils.ts",
  "../sveltekit/tests/test-utils.ts",
];

describe("standalone example parity", () => {
  test.each(styles)("%s includes the common stylesheet locally", async (filename) => {
    const [local, common] = await Promise.all([
      readFile(new URL(filename, import.meta.url), "utf8"),
      readFile(new URL("styles.css", import.meta.url), "utf8"),
    ]);
    expect(local).toBe(common);
  });
  test.each(navigation)("%s includes the common browser navigation locally", async (filename) => {
    const [local, common] = await Promise.all([
      readFile(new URL(filename, import.meta.url), "utf8"),
      readFile(new URL("navigation.ts", import.meta.url), "utf8"),
    ]);
    expect(local).toBe(common);
  });
  test.each(testUtilities)(
    "%s includes the common production test utilities locally",
    async (filename) => {
      const [local, common] = await Promise.all([
        readFile(new URL(filename, import.meta.url), "utf8"),
        readFile(new URL("test-utils.ts", import.meta.url), "utf8"),
      ]);
      expect(local).toBe(common);
    },
  );
});
