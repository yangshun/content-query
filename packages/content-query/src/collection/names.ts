/** The generated names of one collection's entry module. */
export type CollectionNames = {
  /** The export and import path segment, such as `blogPosts` in `#content-query/blogPosts`. */
  exportName: string;
  /** The generated entry type, such as `ContentBlogPost`. */
  typeName: string;
  /** The generated payload type, such as `ContentBlogPostPayload`. */
  payloadTypeName: string;
};

/** Words that cannot name a `const` binding in an ES module, or that read as module syntax. */
const reservedWords = new Set(
  (
    "arguments await break case catch class const continue debugger default delete do else " +
    "enum eval export extends false finally for function if implements import in instanceof " +
    "interface let new null package private protected public return static super switch this " +
    "throw true try typeof var void while with yield"
  ).split(" "),
);
/** Names Windows reserves for devices, in any letter case, which cannot name a directory. */
const deviceName = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Uppercases the first character, keeping the rest of a camelCase name. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Converts a collection name into the identifier its entry exports and its import path uses.
 * Characters that cannot appear in an identifier separate camelCase words, a leading digit gets
 * an `_` prefix, and reserved words and Windows device names get a `Collection` suffix.
 *
 * @param name - The collection's key in the `collections` registry.
 * @returns The export name, such as `blogPosts` for `blog-posts`.
 */
export function exportNameOf(name: string): string {
  const words = name.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  let converted = words.map((word, index) => (index === 0 ? word : capitalize(word))).join("");
  if (!converted) {
    converted = "collection";
  } else if (/^[0-9]/.test(converted)) {
    converted = `_${converted}`;
  }
  return reservedWords.has(converted) || deviceName.test(converted)
    ? `${converted}Collection`
    : converted;
}

/**
 * Derives the singular word for generated type names by dropping one trailing `s`. Names ending
 * in `ss`, such as `address`, keep it. Irregular plurals use the collection's `typeName`.
 *
 * @param exportName - The collection's export name.
 * @returns The singular form, such as `blogPost` for `blogPosts`.
 */
export function singularOf(exportName: string): string {
  return exportName.length > 1 && exportName.endsWith("s") && !exportName.endsWith("ss")
    ? exportName.slice(0, -1)
    : exportName;
}

/**
 * Computes every collection's generated names and rejects names that would collide.
 *
 * @param registry - Collection keys with each collection's optional `typeName` override.
 * @returns The names of each collection's entry, keyed by collection name.
 * @throws An `Error` naming the conflict when two collections share an export or type name, or
 * when a `typeName` is not an identifier.
 */
export function collectionNames(
  registry: Readonly<Record<string, { readonly typeName?: unknown }>>,
): Map<string, CollectionNames> {
  const names = new Map<string, CollectionNames>();
  const exports = new Map<string, string>();
  const types = new Map<string, string>();
  for (const [name, definition] of Object.entries(registry)) {
    const declared = definition?.typeName;
    if (declared !== undefined && (typeof declared !== "string" || !identifier.test(declared))) {
      throw new Error(
        `Collection "${name}" typeName must be an identifier such as "Category"; received ${JSON.stringify(declared)}.`,
      );
    }
    const exportName = exportNameOf(name);
    const typeName = `Content${capitalize(declared ?? singularOf(exportName))}`;
    // Export names are also directory names, which some file systems compare without case.
    const exported = exports.get(exportName.toLowerCase());
    if (exported !== undefined) {
      throw new Error(
        `Collections "${exported}" and "${name}" both export "${exportName}" (ignoring letter case), which their #content-query entries cannot share. Rename one of them.`,
      );
    }
    const payloadTypeName = `${typeName}Payload`;
    for (const generated of [typeName, payloadTypeName]) {
      const typed = types.get(generated);
      if (typed !== undefined) {
        throw new Error(
          `Collections "${typed}" and "${name}" both generate the type "${generated}". Set typeName on one of them.`,
        );
      }
      types.set(generated, name);
    }
    exports.set(exportName.toLowerCase(), name);
    names.set(name, { exportName, typeName, payloadTypeName });
  }
  return names;
}
