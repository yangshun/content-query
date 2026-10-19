import { fileURLToPath } from "node:url";
import { testStaticExample } from "./test-utils";

testStaticExample(
  fileURLToPath(new URL("../", import.meta.url)),
  "TanStack Start",
  ["src"],
  "dist/client",
  false,
);
