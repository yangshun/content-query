import path from "node:path";
import picomatch from "picomatch";
import { withinDirectory } from "../shared/paths.ts";
import type { BuiltinLoader, GlobOptions } from "./descriptor.ts";

const matchers = new WeakMap<GlobOptions, (relative: string) => boolean>();

/**
 * Builds a watch-time superset of tinyglobby discovery: every file discovery could return
 * matches, so an edit is never missed, while unrelated files are ignored.
 */
function globMatcher(options: GlobOptions): (relative: string) => boolean {
  const cached = matchers.get(options);
  if (cached) {
    return cached;
  }
  const patterns = typeof options.pattern === "string" ? [options.pattern] : options.pattern;
  const negated = (pattern: string) => pattern.startsWith("!") && !pattern.startsWith("!(");
  const included = patterns.filter((pattern) => pattern && !negated(pattern));
  const excluded = patterns.filter((pattern) => pattern && negated(pattern));
  const matchOptions = { dot: false, posix: true };
  let matcher: (relative: string) => boolean;
  if (included.some((pattern) => pattern.startsWith("..") || path.posix.isAbsolute(pattern))) {
    // Discovery re-roots these patterns; matching every file is the safe superset.
    matcher = () => true;
  } else {
    // Discovery expands directory patterns, so also accept everything below each match.
    const match = picomatch(
      included.flatMap((pattern) => {
        const normalized = path.posix.normalize(pattern).replace(/\/$/, "");
        return [normalized, `${normalized}/**`];
      }),
      matchOptions,
    );
    // Discovery's expanded exclusions ignore at least these paths, so ignoring them is safe.
    const ignore = excluded.length
      ? picomatch(
          excluded.map((pattern) => path.posix.normalize(pattern.slice(1))),
          matchOptions,
        )
      : () => false;
    matcher = (relative) => match(relative) && !ignore(relative);
  }
  matchers.set(options, matcher);
  return matcher;
}

/** Reports whether a filesystem event can change a built-in loader's next snapshot. */
export function affectsSnapshot(
  descriptor: BuiltinLoader,
  base: string,
  event: string,
  filename: string,
): boolean {
  if (event === "addDir") {
    // Chokidar announces directories before subscribing to their children.
    return false;
  }
  if (filename === base) {
    return true;
  }
  if (
    event === "unlinkDir" &&
    (withinDirectory(filename, base) ||
      (descriptor.kind === "glob" && withinDirectory(base, filename)))
  ) {
    // Removed directories do not report every contained file, so reload conservatively.
    return true;
  }
  if (descriptor.kind !== "glob" || !withinDirectory(base, filename)) {
    return false;
  }
  return globMatcher(descriptor.options)(path.relative(base, filename).split(path.sep).join("/"));
}
