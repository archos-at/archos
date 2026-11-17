export interface ActiveLessonRank {
  id: string
}

export function selectCapacityEvictions(
  activeByRecency: readonly ActiveLessonRank[],
  maxActive: number,
  protectedId?: string
): string[] {
  const kept = protectedId && activeByRecency.some((row) => row.id === protectedId) ? 1 : 0
  const others = activeByRecency.filter((row) => row.id !== protectedId)
  return others.slice(Math.max(maxActive - kept, 0)).map((row) => row.id)
}
