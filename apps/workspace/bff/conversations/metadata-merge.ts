/**
 * How a patch is merged into a message's `metadata`: the pure half of
 * `mergeMessageMetadata` (`repository.ts`), which runs it under the row lock.
 *
 * Its own module so a spec can hold two writers of one message to the same
 * merge without a database: the browser's PATCH and the agent tier's stage
 * write (`agent-stage-frame.ts`) both end here.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * `current` with `entries` on top, per top-level key. A key named in
 * `deepMergeKeys` whose stored and new values are both objects is merged one
 * level down instead of replaced, so a writer of one entry (a card decision, a
 * stage's output) never erases another's.
 */
export function mergeMetadataEntries(
  current: Record<string, unknown>,
  entries: Record<string, unknown>,
  deepMergeKeys: readonly string[] = [],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current, ...entries }
  for (const key of deepMergeKeys) {
    const before = current[key]
    const after = entries[key]
    if (isPlainObject(before) && isPlainObject(after)) {
      merged[key] = { ...before, ...after }
    }
  }
  return merged
}
