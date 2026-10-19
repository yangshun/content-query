import { fileURLToPath } from "node:url";
import path from "node:path";
import { testStaticExample } from "./test-utils";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

testStaticExample(
  appRoot,
  "React Router",
  ["app", "react-router.config.ts"],
  "build/client",
  true,
  ["exec", path.join(appRoot, "node_modules/.bin/react-router"), "build"],
);
