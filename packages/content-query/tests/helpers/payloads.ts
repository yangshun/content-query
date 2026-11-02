type PayloadQueries = {
  query: Record<
    string,
    { findFirst(options: object): Promise<{ _payloads: Record<string, unknown> } | undefined> }
  >;
};

/**
 * Reads one entry's built-in payload through a query, as applications do.
 *
 * @param content - A prepared content runtime.
 * @param collection - The collection key.
 * @param id - The entry ID; a missing entry throws.
 * @param name - The built-in payload to load.
 * @returns The payload value.
 */
async function payloadOf(
  content: unknown,
  collection: string,
  id: string,
  name: "_body" | "_rendered",
): Promise<unknown> {
  const entry = await (content as PayloadQueries).query[collection]!.findFirst({
    where: { id },
    columns: {},
    payloads: { [name]: true },
  });
  if (!entry) {
    throw new Error(`Entry "${id}" does not exist in "${collection}".`);
  }
  return entry._payloads[name];
}

/** Reads an entry's retained raw body through a `_body` payload query. */
export async function bodyOf(
  content: unknown,
  collection: string,
  id: string,
): Promise<string | undefined> {
  return (await payloadOf(content, collection, id, "_body")) as string | undefined;
}

/** Reads an entry's HTML and headings through a `_rendered` payload query. */
export async function renderedOf(
  content: unknown,
  collection: string,
  id: string,
): Promise<{ html: string; headings: { depth: number; slug: string; text: string }[] }> {
  return (await payloadOf(content, collection, id, "_rendered")) as never;
}
