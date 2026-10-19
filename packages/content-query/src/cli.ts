#!/usr/bin/env node
import { prepareAtRoot } from "./preparation/build.ts";
import { parseArguments } from "./integrations/cli/arguments.ts";
import { report } from "./integrations/cli/report.ts";

try {
  const options = parseArguments(process.argv.slice(2));
  const session = await prepareAtRoot(
    process.cwd(),
    options,
    options.watch
      ? (state) => {
          if (state.error) {
            report(state.error);
          } else {
            console.log("[content-query] Content ready.");
          }
        }
      : undefined,
  );
  if (options.watch) {
    process.once("SIGINT", () => {
      void session.dispose();
    });
    process.once("SIGTERM", () => {
      void session.dispose();
    });
  } else {
    await session.dispose();
  }
} catch (cause) {
  report(cause);
  process.exitCode = 1;
}
