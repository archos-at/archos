import type { Translator } from '@/i18n'
import type { RevisionLinks } from '@/lib/documents/revision-links'
import type { TimelineRow } from '@/lib/documents/revision-timeline'
import type { NextStep, RevisionStanding, resolvePerson } from './revision-standing'

const NEXT_STEP_KEYS: Record<NextStep['kind'], { who: string; you: string }> = {
  approve: { who: 'next.approve', you: 'next.approveYou' },
  revise: { who: 'next.revise', you: 'next.reviseYou' },
  submit: { who: 'next.submit', you: 'next.submitYou' },
  publish: { who: 'next.publish', you: 'next.publishYou' },
}

export function nextStepText(
  step: NextStep,
  person: (userId: string | null) => ReturnType<typeof resolvePerson>,
  t: Translator,
  locale: string,
): string {
  const keys = NEXT_STEP_KEYS[step.kind]
  const rail = (key: string, params?: Record<string, string | number>) => t(`preview.revision.rail.${key}`, params)
  if (step.you) return rail(keys.you)
  if (step.kind === 'publish') return rail(keys.who)
  if (step.people.length === 0) return step.kind === 'approve' ? rail('next.approveOpen') : rail(keys.who, { who: rail('someone') })
  const named = [
    ...new Set(
      step.people.map((userId) => {
        const who = person(userId)
        return keepTogether(who.kind === 'name' ? who.name : rail('someone'))
      }),
    ),
  ]
  const who =
    named.length > 2
      ? rail('whoMore', { names: named[0] ?? '', count: named.length - 1 })
      : new Intl.ListFormat(locale, { type: 'disjunction' }).format(named)
  return rail(keys.who, { who })
}

export function answerText(standing: RevisionStanding, t: Translator): string {
  const { answer } = standing
  switch (answer.kind) {
    case 'older':
    case 'newer':
      return t(`preview.revision.rail.answer.${answer.kind}`, { number: answer.number })
    case 'retired':
      return t('lifecycle.meaning.archived')
    default:
      return t(`preview.revision.rail.answer.${answer.kind}`)
  }
}

export function keepTogether(text: string): string {
  return text.replace(/ /g, '\u00a0')
}

export function changeCaptionFor(summary: RevisionLinks['changeSummary'], rows: readonly TimelineRow[], t: Translator): string | null {
  if (summary === null) return null
  const basis = summary.basis
  const against =
    basis === 'previous'
      ? rows.find((row) => row.kind === 'linked' && row.direct)
      : rows.find((row) => row.kind === 'linked' && row.entry.id === basis.id)
  if (against) return t('preview.revision.rail.changedSince', { number: against.number })
  return basis === 'previous'
    ? t('preview.revision.changedSincePrevious')
    : t('preview.revision.changedSince', { name: basis.filename })
}
