import type { Loader, LoaderEntry } from "../../src/loaders/types.ts";
import { populateStore } from "../../src/loaders/populate.ts";
import { createLoaderSession } from "../../src/preparation/loaders/session.ts";

/** Turns raw test records into a native store-writing loader. */
export function fixtureLoader(snapshot: () => LoaderEntry[] | Promise<LoaderEntry[]>): Loader {
  return {
    name: "fixture",
    async load(context) {
      await populateStore(context, await snapshot());
    },
  };
}

/** Exercises a loader through its real preparation context without a configuration file. */
export async function collectLoader(loader: Loader, root = process.cwd()): Promise<LoaderEntry[]> {
  const controller = new AbortController();
  return createLoaderSession(loader, {
    root,
    collection: "fixture",
    signal: controller.signal,
  }).load({ signal: controller.signal });
}
