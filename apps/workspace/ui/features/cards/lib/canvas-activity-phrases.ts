import { formatDayRange } from '@/lib/format'
import type { useTranslations } from '@/i18n'
import type { activityCounts, CanvasFieldChange } from './canvas-activity'

type Translate = ReturnType<typeof useTranslations>

export function headline(t: Translate, counts: ReturnType<typeof activityCounts>): string {
  const acts = (['created', 'proposed', 'changed', 'deleted'] as const)
    .filter((act) => counts[act] > 0)
    .map((act) => t(`cards.canvasActivity.headline.${act}`, { count: counts[act] }))
  if (acts.length > 0) {
    if (counts.replied > 0) acts.push(t('cards.canvasActivity.headline.repliedPart', { threads: counts.replied }))
    return acts.join(', ')
  }
  if (counts.repliedNumber !== null) {
    return t('cards.canvasActivity.headline.repliedOne', { number: counts.repliedNumber })
  }
  return t('cards.canvasActivity.headline.repliedMany', { count: counts.replied })
}

export function changePhrase(t: Translate, locale: string, change: CanvasFieldChange): string {
  const after = change.after ?? null
  switch (change.field) {
    case 'status':
      if (after === 'open') {
        return t(change.before === 'proposed' ? 'cards.canvasActivity.change.taken' : 'cards.canvasActivity.change.reopened')
      }
      return t(after === 'dismissed' ? 'cards.canvasActivity.change.dismissed' : 'cards.canvasActivity.change.resolved')
    case 'assignee':
      if (!after) return t('cards.canvasActivity.change.unassigned')
      return t('cards.canvasActivity.change.assigned', {
        name: change.after_label ?? t('cards.canvasActivity.change.someone'),
      })
    case 'due_on':
      return after
        ? t('cards.canvasActivity.change.due', { date: formatDayRange(after, after, locale) })
        : t('cards.canvasActivity.change.undue')
    case 'kind':
      return t('cards.canvasActivity.change.kind', {
        kind: after === 'hint' || after === 'question' || after === 'defect' ? t(`cards.canvasActivity.kinds.${after}`) : '',
      })
    default:
      return t('cards.canvasActivity.change.body')
  }
}
