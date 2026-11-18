'use client'

import { memo, type JSX } from 'react'
import { identityInk } from '@/components/ui/avatar-identity'
import type { AnnotationView } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import { usePeersOnPage, type DocumentRoom, type RoomPeerState } from '../../../hooks/use-document-room'
import { usePeerSelections } from '../../../hooks/use-peer-selections'
import { box, draftTagPlace, selectionTagged } from '../../../lib/review-overlay-geometry'
import { firstName, isAgentPeer } from '../../../lib/review-peer-state'
import { PeerPointer } from './peer-pointer'
import { PeerSelection } from './peer-selection'

const DRAFT_TAG_CLASSES: Record<ReturnType<typeof draftTagPlace>, string> = {
  above: 'right-0 -top-px -translate-y-full rounded-t-[3px]',
  inside: 'right-0 top-0 rounded-bl-[3px]',
  'beside-right': 'left-full top-0 ml-1 rounded-[3px]',
  'beside-left': 'right-full top-0 mr-1 rounded-[3px]',
}

export const PageCompany = memo(function PageCompany({
  room,
  page,
  focused,
  size,
  marks,
  selfUserId,
  agentThinking,
}: {
  room: Pick<DocumentRoom, 'peers'>
  page: number
  focused: boolean
  size: { width: number; height: number }
  marks: readonly AnnotationView[]
  selfUserId: string | null
  agentThinking: boolean
}): JSX.Element {
  const here = usePeersOnPage(room, page)
  const selections = usePeerSelections(room, selfUserId)
  const pointers = here.filter((state): state is RoomPeerState & { cursor: NonNullable<RoomPeerState['cursor']> } =>
    Boolean(state.cursor)
  )
  const now = (state: RoomPeerState): RoomPeerState =>
    pointers.find((pointer) => pointer.peer.peerId === state.peer.peerId) ?? { ...state, cursor: null }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30" data-testid={`review-company-${page}`}>
      {marks.map((annotation) => {
        const selectors = selections.get(annotation.id)
        if (!selectors) return null
        return (
          <PeerSelection
            key={annotation.id}
            annotation={annotation}
            selectors={selectors}
            tagged={focused ? selectionTagged(selectors.map(now), annotation, size) : []}
            pageHeight={size.height}
          />
        )
      })}

      {/* The boxes the others are drawing right now, in their colour, with whose they are. */}
      {pointers.map((state) =>
        state.draft && !isAgentPeer(state) ? (
          <span
            key={`draft-${state.peer.peerId}`}
            data-testid="review-peer-draft"
            className="absolute rounded-[2px] border-[1.5px] border-dashed"
            style={{
              ...box(state.draft.x, state.draft.y, state.draft.w, state.draft.h),
              borderColor: identityInk(state.peer.userId),
              backgroundColor: `color-mix(in oklch, ${identityInk(state.peer.userId)} 6%, transparent)`,
            }}
          >
            {focused && (
              <span
                data-testid="review-peer-draft-tag"
                data-place={draftTagPlace(state.draft, firstName(state.peer.name), size)}
                className={cn(
                  'absolute px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap text-background shadow-sm',
                  DRAFT_TAG_CLASSES[draftTagPlace(state.draft, firstName(state.peer.name), size)]
                )}
                style={{ backgroundColor: identityInk(state.peer.userId) }}
              >
                {firstName(state.peer.name)}
              </span>
            )}
          </span>
        ) : null
      )}

      {size.width > 0 &&
        pointers.map((state) => (
          <PeerPointer key={state.peer.peerId} state={state} size={size} focused={focused} agentThinking={agentThinking} />
        ))}
    </div>
  )
})
