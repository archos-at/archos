import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { DOCUMENT_VERSION_TRANSITIONS, type DocumentVersionOp } from './lifecycle-types'
import { DOCUMENT_VERSION_STATES, type DocumentVersionState } from './lifecycle-vocabulary'

/**
 * `DOCUMENT_VERSION_TRANSITIONS` read as a lifecycle (ADR-0178), for whoever asks the general
 * questions (which states are final, what may become `published`, the diagram
 * in `docs/architecture/lifecycles.generated.md`). The rows stay the source:
 * they carry actor, permission, guards and effects, which a lifecycle does not.
 *
 * Two things the rows do not say are added here. `supersede` is the move a
 * `promotes` row makes on the PREVIOUS published version. And `approved` is a
 * birth state only on paper: no row lands in it any more (approving publishes),
 * but rows from before that still hold it and may be published.
 */
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
