/**
 * The active-set capacity rule, as a pure function so the ordering is testable
 * without a database (docs/architecture/platform-failure-learning.md).
 */

export interface ActiveLessonRank {
  id: string
}

/**
 * Which active lessons to retire so at most `maxActive` remain. `activeByRecency`
 * is ordered freshest-reported first. `protectedId` (an operator's explicit
 * activation in this very request) is never chosen: it holds a slot and the
 * stalest OTHER lessons give way.
 */
export function selectCapacityEvictions(
  activeByRecency: readonly ActiveLessonRank[],
  maxActive: number,
  protectedId?: string
): string[] {
  const kept = protectedId && activeByRecency.some((row) => row.id === protectedId) ? 1 : 0
  const others = activeByRecency.filter((row) => row.id !== protectedId)
  return others.slice(Math.max(maxActive - kept, 0)).map((row) => row.id)
}
