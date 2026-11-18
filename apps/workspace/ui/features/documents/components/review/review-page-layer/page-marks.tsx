'use client'

import { memo, type JSX } from 'react'
import { identityInk } from '@/components/ui/avatar-identity'
import { COMMENT_PIN_ON_POINT, CommentPin } from '@/components/ui/comment-pin'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isAgentKind } from '@/lib/agent-kind'
import { isLive, type AnnotationView } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import type { RoomPeerState } from '../../../hooks/use-document-room'
import { at, box } from '../../../lib/review-overlay-geometry'
import { pinLabel } from '../../../lib/review-pin-label'
import { useAgentByline } from '../agent-attribution'

export function markInk(annotation: Pick<AnnotationView, 'authorKind' | 'createdBy'>): string {
  return isAgentKind(annotation.authorKind) ? 'var(--paper-ink)' : identityInk(annotation.createdBy)
}

export const PageMarks = memo(function PageMarks({
  marks,
  ghost = false,
  unread,
  focused,
  selectedId,
  hoveredId,
  selections,
  onPin,
  onHover,
}: {
  marks: readonly AnnotationView[]
  ghost?: boolean
  unread: ReadonlySet<string>
  focused: boolean
  selectedId: string | null
  hoveredId: string | null
  selections: Map<string, RoomPeerState[]>
  onPin: (annotationId: string, byKeyboard: boolean) => void
  onHover: (annotationId: string | null) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const byline = useAgentByline()
  return (
    <>
      {marks.map((annotation) => {
        const active = annotation.id === selectedId || annotation.id === hoveredId
        const ink = markInk(annotation)
        const proposed = annotation.status === 'proposed'
        const agentLine =
          isAgentKind(annotation.authorKind) ? byline(annotation.createdByName, { proposal: proposed }) : undefined
        const done = !isLive(annotation)
        const openBy = selections.get(annotation.id)
        return (
          <div key={annotation.id} className={cn('contents', active && '[&>*]:z-20')}>
            {annotation.shape === 'region' && annotation.w && annotation.h && (
              <span
                data-testid="review-region"
                aria-hidden
                className={cn(
                  'absolute rounded-[2px] border-[1.5px] mix-blend-multiply transition-[background-color,opacity] duration-quick ease-out motion-reduce:transition-none',
                  proposed && 'border-dashed',
                  done && 'opacity-40',
                  ghost && 'border-dotted opacity-60'
                )}
                style={{
                  ...box(annotation.x, annotation.y, annotation.w, annotation.h),
                  borderColor: ink,
                  backgroundColor: active ? `color-mix(in oklch, ${ink} 9%, transparent)` : 'transparent',
                }}
              />
            )}
            <span
              className={cn('pointer-events-auto absolute z-10', COMMENT_PIN_ON_POINT)}
              style={at(annotation.x, annotation.y)}
            >
              <CommentPin
                data-testid={ghost ? 'review-ghost-pin' : 'review-pin'}
                className="touch-target"
                number={annotation.number}
                color={ink}
                proposed={proposed}
                done={done}
                ghost={ghost}
                unread={unread.has(annotation.id) && annotation.id !== selectedId}
                active={annotation.id === selectedId}
                aria-label={pinLabel(t, annotation, agentLine, openBy, {
                  ghost,
                  unread: unread.has(annotation.id) && annotation.id !== selectedId,
                })}
                aria-haspopup="dialog"
                aria-expanded={focused ? annotation.id === selectedId : undefined}
                title={agentLine}
                onPointerEnter={() => onHover(annotation.id)}
                onPointerLeave={() => onHover(null)}
                data-peer-selected={openBy ? true : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  onPin(annotation.id, event.detail === 0)
                }}
              />
            </span>
          </div>
        )
      })}
    </>
  )
})
