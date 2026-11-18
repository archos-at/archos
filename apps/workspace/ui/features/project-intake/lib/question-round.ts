import type { DocumentRequest, IntakeView, Need, Suggestion } from '@/lib/project-intake/types'

export const ROUND_GROUPS = ['missing', 'location', 'contradiction'] as const
export type RoundGroup = (typeof ROUND_GROUPS)[number]

export type RoundEntry =
  | { id: string; group: 'missing'; kind: 'need'; need: Need }
  | { id: string; group: 'location'; kind: 'request'; request: DocumentRequest }
  | { id: string; group: 'contradiction'; kind: 'contradiction'; contradiction: Suggestion }

export interface QuestionRound {
  questions: Need[]
  requests: DocumentRequest[]
  contradictions: Suggestion[]
  entries: RoundEntry[]
  settled: RoundEntry[]
  openIds: string[]
  settledIds: string[]
  more: Need[]
}

const requestEntry = (request: DocumentRequest): RoundEntry => ({
  id: `request:${request.determinant}`,
  group: 'location',
  kind: 'request',
  request,
})

export function questionRound(view: IntakeView): QuestionRound {
  const register = view.locationRegister
  const asked = new Map<string, Need>()
  for (const need of [...(register?.questions ?? []), ...view.questions]) if (!asked.has(need.key)) asked.set(need.key, need)
  const questions = [...asked.values()]
  const all = register?.documentRequests ?? []
  const requests = all.filter((request) => !request.satisfied)
  const contradictions = view.contradictions
  const shown = new Set([
    ...asked.keys(),
    ...requests.flatMap((request) => request.keys),
    ...contradictions.map((item) => item.key),
  ])
  const entries: RoundEntry[] = [
    ...questions.map((need): RoundEntry => ({ id: `question:${need.key}`, group: 'missing', kind: 'need', need })),
    ...requests.map(requestEntry),
    ...contradictions.map(
      (contradiction): RoundEntry => ({
        id: `contradiction:${contradiction.key}`,
        group: 'contradiction',
        kind: 'contradiction',
        contradiction,
      })
    ),
  ]
  const settled = all.filter((request) => request.satisfied).map(requestEntry)
  return {
    questions,
    requests,
    contradictions,
    entries,
    settled,
    openIds: entries.map((entry) => entry.id),
    settledIds: settled.map((entry) => entry.id),
    more: view.openQuestions.filter((need) => !shown.has(need.key)),
  }
}
