/**
 * Runs an async mapper over `items` with at most `limit` in flight.
 *
 * Firing every request at once is faster in theory and worse in practice
 * against a rate-limited API: a 10-section lesson translating all 10 sections
 * simultaneously trips the per-minute request limit, and most of the batch
 * comes back 429 instead of translated. A small window keeps the work
 * concurrent without bursting.
 *
 * Results keep the input order. The mapper is expected to handle its own
 * failures (returning a sentinel) — a rejection here rejects the whole call.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
