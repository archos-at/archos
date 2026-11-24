import type { DocumentReview } from '../../../hooks/use-document-review'
import type { TapeMode } from '../../../hooks/use-sheet-tape'

const MODE_BY_KEY: Record<string, TapeMode> = { d: 'distance', w: 'path', f: 'area' }

export function measureKey(key: string, review: Pick<DocumentReview, 'tool' | 'setTool' | 'tape'>): boolean {
  const { tape } = review
  if (key === 'm') {
    if (!tape.available) return false
    review.setTool(review.tool === 'measure' ? 'select' : 'measure')
    return true
  }
  if (review.tool !== 'measure') return false
  const mode = MODE_BY_KEY[key]
  if (mode) {
    tape.setMode(mode)
    return true
  }
  if (key === 'enter' && tape.canFinish) {
    tape.finish()
    return true
  }
  if ((key === 'backspace' || key === 'delete') && tape.points.length > 0) {
    tape.undo()
    return true
  }
  return false
}

export const tapeInHand = (review: Pick<DocumentReview, 'tool' | 'tape'>): boolean =>
  review.tool === 'measure' && (review.tape.points.length > 0 || review.tape.phase !== 'placing')
