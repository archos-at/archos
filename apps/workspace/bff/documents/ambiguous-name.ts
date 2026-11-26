import { ConflictError } from '@/lib/api/errors'

export const AMBIGUOUS_NAME_REASON = 'ambiguous_name'

export class AmbiguousDocumentNameError extends ConflictError {
  constructor() {
    super('More than one document in this collection has this name; ask by its document id', { reason: AMBIGUOUS_NAME_REASON })
  }
}
