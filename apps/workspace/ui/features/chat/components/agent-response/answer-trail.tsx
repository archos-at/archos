import { type FC, useEffect, useState } from 'react'
import { Brain, Folder, FolderKanban, Lock, UserRound } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { answerTrailFor, type AnswerTrailPlace, type AnswerTrailView } from '../../lib/answer-trails'

export const AnswerTrailSection: FC<{ conversationId: string; messageId: string }> = ({ conversationId, messageId }) => {
  const t = useTranslations(chatCopy)
  const [trail, setTrail] = useState<AnswerTrailView | null>(null)

  useEffect(() => {
    let current = true
    answerTrailFor(conversationId, messageId).then(
      (found) => current && setTrail(found),
      () => current && setTrail(null),
    )
    return () => {
      current = false
    }
  }, [conversationId, messageId])

  if (!trail || (trail.places.length === 0 && !trail.personalMemory && !trail.personalShelf)) return null
  const placeLabel = (place: AnswerTrailPlace): string =>
    'withheld' in place
      ? t(place.kind === 'project' ? 'answerDetails.trail.withheldProject' : 'answerDetails.trail.withheldFolder')
      : place.name

  return (
    <div className="flex flex-col gap-1.5" data-testid="answer-trail">
      <SectionLabel>{t('answerDetails.trail.label')}</SectionLabel>
      <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label={t('answerDetails.trail.label')}>
        {trail.places.map((place, index) => {
          const Icon = 'withheld' in place ? Lock : place.kind === 'project' ? FolderKanban : Folder
          return (
            <span key={'id' in place ? place.id : `withheld-${index}`} role="listitem">
              <Chip size="sm" variant="muted" data-testid="answer-trail-place">
                <Icon aria-hidden />
                {placeLabel(place)}
              </Chip>
            </span>
          )
        })}
        {trail.personalShelf && (
          <span role="listitem">
            <Chip size="sm" variant="muted" data-testid="answer-trail-personal-shelf">
              <UserRound aria-hidden />
              {t('answerDetails.trail.personalShelf')}
            </Chip>
          </span>
        )}
        {trail.personalMemory && (
          <span role="listitem">
            <Chip size="sm" variant="muted" data-testid="answer-trail-personal-memory">
              <Brain aria-hidden />
              {t('answerDetails.trail.personalMemory')}
            </Chip>
          </span>
        )}
      </div>
    </div>
  )
}
