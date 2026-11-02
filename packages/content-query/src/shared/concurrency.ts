/**
 * Maps items through an asynchronous callback with at most `limit` callbacks in flight.
 * Results keep input order; the first rejection rejects the whole map after started work settles.
 *
 * @param items - Values to process.
 * @param limit - Maximum number of concurrent callbacks; values below one are treated as one.
 * @param callback - Asynchronous work for one item and its index.
 * @returns The callback results in input order.
 */
export async function mapConcurrent<Item, Result>(
  items: readonly Item[],
  limit: number,
  callback: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = Array.from({ length: items.length }) as Result[];
  let next = 0;
  let failure: { cause: unknown } | undefined;
  /** Claims the next unprocessed item until the list is exhausted or work has failed. */
  async function worker(): Promise<void> {
    while (next < items.length && !failure) {
      const index = next++;
      try {
        results[index] = await callback(items[index]!, index);
      } catch (cause) {
        failure ??= { cause };
      }
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker);
  await Promise.all(workers);
  if (failure) {
    throw failure.cause;
  }
  return results;
}
