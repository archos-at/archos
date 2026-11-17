import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { DOCUMENT_VERSION_TRANSITIONS, type DocumentVersionOp } from './lifecycle-types'
import { DOCUMENT_VERSION_STATES, type DocumentVersionState } from './lifecycle-vocabulary'

export const DOCUMENT_VERSION_LIFECYCLE = defineLifecycle<DocumentVersionState, DocumentVersionOp | 'supersede'>({
  id: 'document-version',
  initial: 'draft',
  bornAs: ['published', 'approved'],
  states: Object.fromEntries(
    DOCUMENT_VERSION_STATES.map((state) => {
      const moves: [string, DocumentVersionState][] = DOCUMENT_VERSION_TRANSITIONS.filter((row) => row.from === state).map(
        (row) => [row.op, row.to]
      )
      if (state === 'published') moves.push(['supersede', 'superseded'])
      return [state, moves.length > 0 ? { on: Object.fromEntries(moves) } : { type: 'final' as const }]
    })
  ) as Record<DocumentVersionState, { on?: Partial<Record<DocumentVersionOp | 'supersede', DocumentVersionState>>; type?: 'final' }>,
})
