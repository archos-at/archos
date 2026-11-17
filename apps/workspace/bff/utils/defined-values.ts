export function definedValues<V>(record: Partial<Record<string, V>>): Record<string, V> {
  const defined: Record<string, V> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) defined[key] = value
  }
  return defined
}
