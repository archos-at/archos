const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
