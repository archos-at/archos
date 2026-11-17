import type { AnnotationView } from '@/lib/annotations/types'

export function walkPosition(
  annotations: readonly Pick<AnnotationView, 'id' | 'status' | 'onCurrentRevision'>[],
  id: string | null
): { index: number; total: number } | null {
  const walk = annotations.filter((annotation) => annotation.status === 'proposed' && annotation.onCurrentRevision)
  const index = walk.findIndex((annotation) => annotation.id === id)
  return index === -1 ? null : { index: index + 1, total: walk.length }
}
