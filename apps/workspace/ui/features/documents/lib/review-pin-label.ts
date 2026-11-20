import type { useTranslations } from '@/i18n'
import type { AnnotationView } from '@/lib/annotations/types'
import type { RoomPeerState } from '../hooks/use-document-room'

type Translate = ReturnType<typeof useTranslations>

export function pinLabel(
  t: Translate,
  annotation: Pick<AnnotationView, 'number' | 'kind' | 'status' | 'revisionNumber'>,
  agentLine: string | undefined,
  openBy: readonly RoomPeerState[] | undefined,
  { ghost = false, unread = false }: { ghost?: boolean; unread?: boolean } = {}
): string {
  const state =
    annotation.status === 'proposed'
      ? t('review.pinState.proposed')
      : annotation.status === 'resolved'
        ? t('review.pinState.resolved')
        : annotation.status === 'dismissed'
          ? t('review.pinState.dismissed')
          : null
  const earlier = !ghost
    ? null
    : annotation.revisionNumber
      ? t('review.pinState.ghost', { number: annotation.revisionNumber })
      : t('review.pinState.ghostUnnumbered')
  return [
    t('review.pinLabel', { number: annotation.number, kind: t(`annotations.kinds.${annotation.kind}`) }),
    earlier,
    state,
    unread ? t('review.pinState.unread') : null,
    agentLine,
    openBy && openBy.length > 0
      ? t('review.pinOpenBy', { names: openBy.map((other) => other.peer.name).join(', ') })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
