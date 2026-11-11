'use client'

/**
 * Dev preview for what a chat says about itself (ADR-0180): the temporary
 * switch of the composer, the line under the composer, and the „noted“ chip
 * with who reads each note and the action that takes a note back. The real
 * components, driven by props, no store and no backend. The chip is shown
 * three times: to the asker who may write the project's memory (every row
 * kind; „Entfernen“ works on the page's own state), to a colleague who may
 * only read (no personal row, no remove action on project notes), and with
 * every outcome of taking a note back. Pick a composer state with the toggles
 * or open it by address:
 *
 *   ?state=private              only the reader sees the chat
 *   ?state=temporary            temporary, and private
 *   ?state=temporary-shared     temporary in a shared chat (no private line)
 *   ?state=shared               neither statement holds: the line is absent
 *   ?state=switching            the switch is on its way to the server
 *
 * „Phone row“ stands the switch in the composer's row as a phone has it: 294px
 * for five controls, the other four as boxes of their phone size. At a phone
 * width the switch shows its word without the glyph; the row must not overflow.
 *
 * Not linked from anywhere and 404s outside development (see ../layout.tsx).
 */

import { useState, type JSX } from 'react'
import { RaisedCard, RaisedCardBody } from '@/components/ui/raised-card'
import { SectionLabel } from '@/components/ui/section-label'
import { Textarea } from '@/components/ui/textarea'
import { ConversationPrivacyLineView, TemporaryChatToggleView } from '@/features/chat/conversation-privacy'
import { MemoryNotedChipView } from '@/features/chat/components/MemoryNotedChip'
import type { TurnMemoryItem } from '@/features/chat/lib/turn-memory'
import type { NoteRemoval } from '@/features/chat/stores/turn-notes-store'
import { PreviewStatePicker, usePreviewState } from '../_fixtures/preview-state'

const STATES = ['private', 'temporary', 'temporary-shared', 'shared', 'switching'] as const
type PreviewState = (typeof STATES)[number]

/** Every kind of row one turn can leave: the shelf, when it was written, what it replaced. */
const SHARED: TurnMemoryItem[] = [
  {
    id: 'n-office',
    noteId: 'n-office',
    kind: 'preference',
    content: 'Brandschutzkonzepte werden im Büro immer mit dem Prüfingenieur vorabgestimmt.',
    provenance: 'inTurn',
    audience: 'organization',
  },
  {
    id: 'n-project',
    noteId: 'n-project',
    kind: 'decision',
    content: 'Die Bauherrschaft hat sich für ein extensiv begrüntes Flachdach entschieden.',
    provenance: 'inTurn',
    audience: 'project',
  },
  {
    id: 'n-restricted',
    noteId: 'n-restricted',
    kind: 'constraint',
    content: 'Die Statik des Bestands ist laut Gutachten nur bis 3,5 kN/m² freigegeben.',
    provenance: 'distillation',
    audience: 'restricted',
  },
  {
    id: 'n-correction',
    noteId: 'n-correction',
    kind: 'derived_fact',
    content: 'OIB-RL 2.1 ist anwendbar, das Gebäude ist eine Betriebsanlage.',
    provenance: 'distillation',
    audience: 'project',
    supersedes: 'OIB-RL 2.1 ist nicht anwendbar.',
  },
  {
    // A card the browser decided before proposals recorded what they created: no row to name.
    id: 'memory_proposal-0',
    kind: 'open_question',
    content: 'Ist die Zufahrt für die Feuerwehr im Bebauungsplan gesichert?',
    provenance: 'inTurn',
    audience: 'project',
  },
]

/** The asker's own notes of this answer. Only their browser holds these rows. */
const MINE: TurnMemoryItem[] = [
  {
    id: 'p-preference',
    noteId: 'p-preference',
    kind: 'preference',
    content: 'Möchte Antworten mit den Quellen zuerst.',
    provenance: 'inTurn',
    audience: 'personal',
  },
  {
    id: 'p-profile',
    noteId: 'p-profile',
    kind: 'profile',
    content: 'Leitet im Büro die Einreichplanung.',
    provenance: 'distillation',
    audience: 'personal',
  },
]

const OUTCOMES: Record<string, NoteRemoval> = {
  'n-office': 'removing',
  'n-project': 'removed',
  'p-preference': 'failed',
  'p-profile': 'gone',
}

/** The chip with the page's own state behind „Entfernen“: each click removes on the next tick. */
function RemovableChip({ items, canWrite }: { items: TurnMemoryItem[]; canWrite: boolean }): JSX.Element {
  const [removals, setRemovals] = useState<Record<string, NoteRemoval>>({})
  return (
    <MemoryNotedChipView
      items={items}
      projectId="dev-project"
      shelf={{ canWrite, activeIds: null }}
      removals={removals}
      onRemove={(item) => {
        const id = item.noteId
        if (!id) return
        setRemovals((current) => ({ ...current, [id]: 'removing' }))
        window.setTimeout(() => setRemovals((current) => ({ ...current, [id]: 'removed' })), 600)
      }}
    />
  )
}

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

/** The composer's action row at a phone's width, the switch's four neighbours as boxes of their size there. */
function PhoneRow({ state }: { state: PreviewState }): JSX.Element {
  const [pressed, setPressed] = useState(state === 'temporary' || state === 'temporary-shared')
  const neighbour = 'bg-muted text-muted-foreground flex h-11 shrink-0 items-center justify-center rounded-control text-xs'
  return (
    <div
      className="border-border flex items-center justify-end gap-1 overflow-hidden rounded-control border"
      style={{ width: 294 }}
      data-testid="phone-composer-row"
    >
      <TemporaryChatToggleView pressed={pressed} pending={state === 'switching'} onPressedChange={setPressed} />
      <span className={neighbour} style={{ width: 60 }}>
        Aufwand
      </span>
      {['Anhang', 'Diktat', 'Senden'].map((name) => (
        <span key={name} className={neighbour} style={{ width: 44 }} aria-label={name} />
      ))}
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
        <SectionLabel as="h2">Phone row (294px)</SectionLabel>
        <PhoneRow key={state} state={state} />
      </section>
      <section className="space-y-3">
        <SectionLabel as="h2">Noted chip: the asker, who may write the project’s memory</SectionLabel>
        <div data-testid="noted-asker">
          <RemovableChip items={[...SHARED, ...MINE]} canWrite />
        </div>
      </section>
      <section className="space-y-3">
        <SectionLabel as="h2">Noted chip: a colleague who may only read the project</SectionLabel>
        <div data-testid="noted-colleague">
          <RemovableChip items={SHARED} canWrite={false} />
        </div>
      </section>
      <section className="space-y-3">
        <SectionLabel as="h2">Noted chip: only personal notes</SectionLabel>
        <div data-testid="noted-personal">
          <RemovableChip items={MINE} canWrite={false} />
        </div>
      </section>
      <section className="space-y-3">
        <SectionLabel as="h2">Noted chip: every outcome of taking a note back</SectionLabel>
        <div data-testid="noted-outcomes">
          <MemoryNotedChipView
            items={[...SHARED.slice(0, 2), ...MINE]}
            projectId="dev-project"
            shelf={{ canWrite: true, activeIds: null }}
            removals={OUTCOMES}
            onRemove={() => undefined}
          />
        </div>
      </section>
    </main>
  )
}
