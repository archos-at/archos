import type { IntakeView, Suggestion } from '@/lib/project-intake/types'

export type ReadingPhase = 'waiting' | 'waitingWithDocuments' | 'reading' | 'ready' | 'failed' | 'completed'

export type MilestoneState = 'done' | 'active' | 'pending' | 'attention'

export type ReadingMilestone =
  | { id: 'site'; state: MilestoneState; site: IntakeView['readingProgress']['site'] }
  | { id: 'values' | 'contradictions' | 'gaps'; state: MilestoneState; count: number }

export interface ReadingDocuments {
  read: number
  total: number | null
  unread: number
}

export function readingPhase(view: IntakeView): ReadingPhase {
  if (view.status === 'waiting') {
    return view.counts.documentsRead + view.counts.unreadDocuments === 0 ? 'waiting' : 'waitingWithDocuments'
  }
  return view.status
}

export function readingOver(phase: ReadingPhase): boolean {
  return phase === 'ready' || phase === 'failed' || phase === 'completed'
}

function allValues(view: IntakeView): Suggestion[] {
  return [
    ...view.groups.flatMap((group) => group.items),
    ...view.derivations.flatMap((derivation) => (derivation.suggestion ? [derivation.suggestion] : [])),
  ]
}

export function documentValues(view: IntakeView): Suggestion[] {
  return allValues(view).filter((item) => item.evidence.some((evidence) => evidence.kind === 'document'))
}

export function valuesFound(view: IntakeView): number {
  return documentValues(view).length
}

export function readingDocuments(view: IntakeView): ReadingDocuments {
  const { documentsOpened, documentsTotal } = view.readingProgress
  const { documentsRead, unreadDocuments } = view.counts
  const phase = readingPhase(view)
  if (phase === 'reading') return { read: documentsOpened, total: documentsTotal, unread: unreadDocuments }
  if (phase === 'waiting' || phase === 'waitingWithDocuments') {
    return { read: 0, total: documentsTotal > 0 ? documentsTotal : documentsRead + unreadDocuments, unread: unreadDocuments }
  }
  if (documentsOpened > 0) return { read: documentsOpened, total: documentsTotal, unread: unreadDocuments }
  return { read: documentsRead, total: null, unread: unreadDocuments }
}

function asking(count: number, reading: boolean): MilestoneState {
  if (count > 0) return 'attention'
  return reading ? 'active' : 'done'
}

export function readingMilestones(view: IntakeView): ReadingMilestone[] {
  const phase = readingPhase(view)
  const reading = phase === 'reading'
  const before = phase === 'waiting' || phase === 'waitingWithDocuments'
  const { site } = view.readingProgress
  const siteState: MilestoneState = site.source ? 'done' : reading ? 'active' : before ? 'pending' : 'attention'
  const siteMilestone: ReadingMilestone = { id: 'site', state: siteState, site }
  if (phase === 'waiting') return [siteMilestone]
  const values = valuesFound(view)
  const { contradictions, decisiveOpen } = view.counts
  return [
    siteMilestone,
    { id: 'values', state: values > 0 ? 'done' : reading ? 'active' : 'pending', count: values },
    { id: 'contradictions', state: before ? 'pending' : asking(contradictions, reading), count: contradictions },
    { id: 'gaps', state: before || reading ? 'pending' : asking(decisiveOpen, false), count: decisiveOpen },
  ]
}
