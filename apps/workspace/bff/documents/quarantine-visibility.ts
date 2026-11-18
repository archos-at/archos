export function keepVisibleQuarantine<T extends { status: string; createdBy: string }>(
  rows: T[],
  quarantineReader: string | undefined,
): T[] {
  if (!quarantineReader) return rows
  return rows.filter((row) => row.status !== 'quarantined' || row.createdBy === quarantineReader)
}
