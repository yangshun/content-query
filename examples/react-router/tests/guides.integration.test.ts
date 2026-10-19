import { fileURLToPath } from "node:url";
import { testStaticExample } from "./test-utils";

testStaticExample(
  fileURLToPath(new URL("../", import.meta.url)),
  "React Router",
  ["app", "react-router.config.ts"],
  "build/client",
);
