import type { ProjectMarkView } from '@/lib/annotations/project-types'
import { matchesEveryWord } from '@/shared/utils/every-word'

export const OPEN_POINTS_QUERY_PARAM = 'q'

export function matchesOpenPoint(mark: Pick<ProjectMarkView, 'body' | 'documentName' | 'assigneeName'>, query: string): boolean {
  return matchesEveryWord([mark.body, mark.documentName, mark.assigneeName], query)
}
