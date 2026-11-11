'use client'

/**
 * Dev preview for what a chat says about itself (ADR-0180): the temporary
 * switch of the composer, the line under the composer, and the „noted“ chip
 * with who reads each note. The real components, driven by props, no store
 * and no backend. Pick a state with the toggles or open it by address:
 *
 *   ?state=private              only the reader sees the chat
 *   ?state=temporary            temporary, and private
 *   ?state=temporary-shared     temporary in a shared chat (no private line)
 *   ?state=shared               neither statement holds: the line is absent
 *   ?state=switching            the switch is on its way to the server
 *
 * Not linked from anywhere and 404s outside development (see ../layout.tsx).
 */

import { useState, type JSX } from 'react'
import { RaisedCard, RaisedCardBody } from '@/components/ui/raised-card'
import { SectionLabel } from '@/components/ui/section-label'
import { Textarea } from '@/components/ui/textarea'
import { ConversationPrivacyLineView, TemporaryChatToggleView } from '@/features/chat/conversation-privacy'
import { MemoryNotedChip } from '@/features/chat/components/MemoryNotedChip'
import type { TurnMemoryItem } from '@/features/chat/lib/turn-memory'
import { PreviewStatePicker, usePreviewState } from '../_fixtures/preview-state'

const STATES = ['private', 'temporary', 'temporary-shared', 'shared', 'switching'] as const
type PreviewState = (typeof STATES)[number]

const NOTED: TurnMemoryItem[] = [
  {
    id: 'memory_proposal-0',
    kind: 'preference',
    content: 'Brandschutzkonzepte werden im Büro immer mit dem Prüfingenieur vorabgestimmt.',
    provenance: 'inTurn',
    audience: 'organization',
  },
  {
    id: 'row-1',
    kind: 'decision',
    content: 'Die Bauherrschaft hat sich für ein extensiv begrüntes Flachdach entschieden.',
    provenance: 'distillation',
    audience: 'project',
  },
]

function Composer({ state }: { state: PreviewState }): JSX.Element {
  const startsTemporary = state === 'temporary' || state === 'temporary-shared'
  const [pressed, setPressed] = useState(startsTemporary)
  return (
    <div>
      <RaisedCard>
        <RaisedCardBody className="p-3">
          <Textarea rows={2} placeholder="Frage stellen …" aria-label="Nachricht" />
          <div className="mt-2 flex justify-end">
            <TemporaryChatToggleView pressed={pressed} pending={state === 'switching'} onPressedChange={setPressed} />
          </div>
        </RaisedCardBody>
      </RaisedCard>
      <ConversationPrivacyLineView
        temporary={pressed}
        privateToReader={state === 'private' || state === 'temporary' || state === 'switching'}
      />
    </div>
  )
}

export default function ConversationPrivacyDevPage(): JSX.Element {
  const [state, setState] = usePreviewState(STATES)
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 md:px-8" data-testid="conversation-privacy-preview">
      <PreviewStatePicker label="State" states={STATES} value={state} onChange={setState} />
      <section className="space-y-3">
        <SectionLabel as="h2">Composer</SectionLabel>
        {/* Keyed by the state, so the switch starts where the state says. */}
        <Composer key={state} state={state} />
      </section>
      <section className="space-y-3">
        <SectionLabel as="h2">Noted chip</SectionLabel>
        <MemoryNotedChip items={NOTED} projectId="dev-project" />
      </section>
    </main>
  )
}
