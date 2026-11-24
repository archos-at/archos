import 'server-only'
import { ConflictError, UnprocessableError } from '@/lib/api/errors'
import { AnnotationLimitReachedError } from './repository'
import { MAX_ANNOTATIONS_PER_DOCUMENT } from './types'

export const limitReached = (error: unknown): never => {
  if (error instanceof AnnotationLimitReachedError) {
    throw new UnprocessableError(`A document carries at most ${MAX_ANNOTATIONS_PER_DOCUMENT} Anmerkungen.`)
  }
  throw error
}

export const conflict = () => new ConflictError('Somebody changed this Anmerkung a moment ago. Look again.')
