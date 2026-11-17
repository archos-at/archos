'use client'

import { Suspense, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'

import { AnswerFeedback } from '@/features/chat/components/AnswerFeedback'
import { AnswerFeedbackHealth } from '@/features/platform/components/answer-feedback-health'
import { FeedbackExportDialog } from '@/features/platform/components/feedback-export-dialog'
import { QualityScopeBar, useQualityScopeOptions } from '@/features/platform/components/quality-scope-bar'
import { I18nProvider } from '@/i18n'
import { NO_RATINGS_FILTERS, readRatingsFilters, type RatingsFilters } from '@/lib/feedback/filters'
import { presetRange, readQualityScope, scopeBounds, type QualityScope } from '@/lib/quality/scope'
import { SectionLabel } from '@/components/ui/section-label'

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()

const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

const DAILY_SHAPE: [number, number, number][] = [
  [29, 7, 3],
  [28, 8, 3],
  [27, 5, 1],
  [26, 5, 1],
  [25, 2, 0],
  [24, 7, 1],
  [23, 9, 2],
  [20, 7, 1],
  [19, 10, 1],
  [18, 5, 1],
  [17, 2, 0],
  [16, 10, 1],
  [15, 7, 1],
  [14, 6, 1],
  [13, 6, 1],
  [12, 8, 1],
  [11, 6, 1],
  [10, 7, 1],
  [8, 5, 1],
  [7, 7, 1],
  [6, 9, 2],
  [5, 11, 1],
  [4, 11, 1],
  [3, 7, 1],
  [2, 8, 0],
  [1, 8, 1],
  [0, 9, 1],
]

const TRACE = (id: string): string => `https://cloud.langfuse.com/project/piloti-prod/traces/${id}`

const FIXTURE = {
  windowDays: 30,
  answers: 1284,
  totals: { up: 128, down: 19, voters: 31, downVoters: 4 },
  reasons: [
    { reason: 'inaccurate', count: 11 },
    { reason: 'wrong_source', count: 5 },
    { reason: 'other', count: 2 },
    { reason: null, count: 1 },
  ],
  daily: DAILY_SHAPE.map(([n, up, down]) => ({ day: daysAgo(n), up, down })),
  organizations: [
    {
      organizationId: 'org_arch_buero',
      organizationName: 'Architekturbüro Hofer & Partner',
      up: 120,
      down: 17,
      voters: 28,
    },
    {
      organizationId: 'org_planwerk',
      organizationName: 'Planwerk Graz',
      up: 1,
      down: 1,
      voters: 1,
    },
    { organizationId: 'org_stadtplan', up: 7, down: 1, voters: 3 },
  ],
  topics: [
    { topic: 'fire_safety', up: 41, down: 9, voters: 14 },
    { topic: 'energy', up: 33, down: 2, voters: 11 },
    { topic: 'sound_insulation', up: 12, down: 6, voters: 7 },
    { topic: 'accessibility', up: 9, down: 1, voters: 5 },
    { topic: 'structural', up: 2, down: 1, voters: 2 },
  ],
  turns: [
    {
      id: 'f-1',
      organizationId: 'org_arch_buero',
      organizationName: 'Architekturbüro Hofer & Partner',
      projectId: null,
      conversationId: 'c-atrium',
      messageId: 'm-1',
      verdict: 'down',
      reason: 'inaccurate',
      createdAt: ago(45),
      question: 'Gilt die 40-m-Grenze für Fluchtweglängen auch für das nördliche Treppenhaus?',
      answer:
        'Die maximale Fluchtweglänge beträgt 40 m. Für das nördliche Treppenhaus gilt dieselbe Grenze, da es als notwendiger Treppenraum ausgeführt ist.',
      conversationTitle: 'Atrium, Rauchabschnitte GK 4',
      topics: ['fire_safety'],
      comment:
        'Das nördliche Treppenhaus ist ein Sicherheitstreppenhaus, da gilt eine andere Regel.',
      expectedAnswer:
        'Bei Sicherheitstreppenhäusern darf die Fluchtweglänge laut OIB-RL 2, Punkt 5.1.3 bis zu 50 m betragen.',
      langfuseTraceUrl: TRACE('7c1e2f04a9'),
    },
    {
      id: 'f-2',
      organizationId: 'org_arch_buero',
      organizationName: 'Architekturbüro Hofer & Partner',
      projectId: null,
      conversationId: 'c-brand',
      messageId: 'm-2',
      verdict: 'down',
      reason: 'wrong_source',
      createdAt: ago(210),
      question: 'Welche OIB-Richtlinie regelt die Brandabschnittsgrößen für Gebäudeklasse 4?',
      answer: 'Das ist in OIB-Richtlinie 2 geregelt, Punkt 3.1.',
      conversationTitle: 'Brandabschnitte',
      topics: ['fire_safety', 'general'],
      comment: null,
      expectedAnswer: 'OIB-RL 2, Tabelle 1b, nicht Punkt 3.1.',
      langfuseTraceUrl: TRACE('b31d9e6c20'),
    },
    {
      id: 'f-3',
      organizationId: 'org_planwerk',
      organizationName: 'Planwerk Graz',
      projectId: null,
      conversationId: null,
      messageId: 'm-unpersisted',
      verdict: 'down',
      reason: 'other',
      createdAt: ago(1400),
      question: null,
      answer: null,
      conversationTitle: null,
      topics: [],
      comment: null,
      expectedAnswer: null,
      langfuseTraceUrl: null,
    },
  ],
  langfuse: { projectUrl: 'https://cloud.langfuse.com/project/piloti-prod' },
}

const LANDED = [
  {
    id: 'g-1',
    organizationId: 'org_arch_buero',
    organizationName: 'Architekturbüro Hofer & Partner',
    projectId: null,
    conversationId: 'c-u-wert',
    messageId: 'm-11',
    verdict: 'up',
    reason: null,
    createdAt: ago(90),
    question: 'Welcher U-Wert gilt für Außenwände bei einer thermischen Sanierung im Bestand?',
    answer:
      'Für Außenwände gegen Außenluft fordert OIB-Richtlinie 6 einen U-Wert von höchstens 0,35 W/(m²·K); im Bestand gilt dieser Wert bei einer größeren Renovierung.',
    conversationTitle: 'Sanierung Gründerzeit, Wärmeschutz',
    topics: ['energy'],
    comment: null,
    expectedAnswer: null,
    langfuseTraceUrl: TRACE('e90a11c7d2'),
  },
  {
    id: 'g-2',
    organizationId: 'org_stadtplan',
    projectId: null,
    conversationId: 'c-lift',
    messageId: 'm-12',
    verdict: 'up',
    reason: null,
    createdAt: ago(320),
    question: 'Ab wann ist ein Aufzug barrierefrei erforderlich?',
    answer:
      'OIB-Richtlinie 4 verlangt einen Aufzug, sobald mehr als eine Geschoßebene barrierefrei erschlossen werden muss.',
    conversationTitle: 'Wohnbau Nord, Erschließung',
    topics: ['accessibility'],
  },
]

const DIGEST = {
  digest: {
    headline:
      'In den letzten 30 Tagen wurden 147 Antworten bewertet, 87 % davon als hilfreich. Die Quote hat sich gegenüber dem Beginn des Zeitraums leicht verbessert. Bewertet wurde rund jede zehnte Antwort, die negativen Stimmen stammen von vier Personen.',
    strengths: [
      'Fragen zu Wärmeschutz und U-Werten werden fast durchgehend als hilfreich bewertet.',
      'Barrierefreiheits-Fragen liegen ebenfalls deutlich im positiven Bereich, wenn auch bei kleiner Stichprobe.',
    ],
    concerns: [
      'Die meisten negativen Bewertungen betreffen Fluchtweg- und Brandabschnittsfragen und sind als „ungenau" begründet.',
      'Fast alle negativen Stimmen stammen aus einer einzigen Organisation, die Quote der übrigen ist unauffällig.',
    ],
    recommendation:
      'Die als ungenau markierten Brandschutz-Antworten durchsehen und prüfen, ob die zitierte Stelle der OIB-Richtlinie 2 jeweils die richtige ist.',
    generatedAt: ago(22),
    windowDays: 30,
    votes: 147,
  },
  error: null,
}

const TURN_STATES: Record<
  string,
  { messageId: string; verdict: string; reason: string | null; comment: string | null }[]
> = {
  'af-rest': [],
  'af-up': [{ messageId: 'af-msg', verdict: 'up', reason: null, comment: null }],
  'af-down': [{ messageId: 'af-msg', verdict: 'down', reason: null, comment: null }],
  'af-note': [{ messageId: 'af-msg', verdict: 'down', reason: 'inaccurate', comment: null }],
  'af-sent': [
    {
      messageId: 'af-msg',
      verdict: 'down',
      reason: 'wrong_source',
      comment: 'Zitiert OIB-Richtlinie 2 statt 4.',
    },
  ],
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function previewTurns(params: URLSearchParams): Record<string, unknown>[] {
  const filters = readRatingsFilters(params)
  const orgs = params.getAll('org')
  const pool = filters.verdict === 'up' ? LANDED : filters.verdict === 'down' ? FIXTURE.turns : [...FIXTURE.turns, ...LANDED]
  const q = (filters.query ?? '').toLowerCase()
  return pool.filter((turn) => {
    const record = turn as { reason: string | null; organizationId: string; topics: string[]; question: string | null; answer: string | null }
    return (
      (filters.reasons.length === 0 || filters.reasons.some((reason) => reason === (record.reason ?? 'other'))) &&
      (orgs.length === 0 || orgs.includes(record.organizationId)) &&
      (filters.topics.length === 0 || filters.topics.some((topic) => record.topics.includes(topic))) &&
      (!q || `${record.question ?? ''} ${record.answer ?? ''}`.toLowerCase().includes(q))
    )
  })
}

const SCOPE_ORGANIZATIONS = [
  { id: 'org_arch_buero', name: 'Architekturbüro Hofer & Partner' },
  { id: 'org_planwerk', name: 'Planwerk Graz' },
  { id: 'org_stadtplan', name: null },
  { id: 'org_atelier_nord', name: 'Atelier Nord Ziviltechniker GmbH' },
]

const SCOPE_PROJECTS = [
  { id: '0b6f2a1e-5c3d-4e8f-9a7b-1c2d3e4f5a61', name: 'Wohnanlage Innsbruck West', organizationId: 'org_arch_buero' },
  { id: '0b6f2a1e-5c3d-4e8f-9a7b-1c2d3e4f5a62', name: 'Schule Hötting, Zubau', organizationId: 'org_arch_buero' },
  { id: '0b6f2a1e-5c3d-4e8f-9a7b-1c2d3e4f5a63', name: 'Stadthaus Lend', organizationId: 'org_planwerk' },
]

const OPTIONS = {
  scopeTotal: 147,
  cap: 5000,
  overCap: false,
  verdicts: { up: 128, down: 19 },
  reasons: [
    { key: 'inaccurate', votes: 11 },
    { key: 'wrong_source', votes: 5 },
    { key: 'too_slow', votes: 0 },
    { key: 'other', votes: 3 },
  ],
  topics: [
    { key: 'fire_safety', votes: 50 },
    { key: 'energy', votes: 35 },
    { key: 'sound_insulation', votes: 18 },
    { key: 'accessibility', votes: 10 },
    { key: 'structural', votes: 3 },
  ],
  modes: [
    { key: 'meta', votes: 4 },
    { key: 'shallow', votes: 102 },
    { key: 'deep', votes: 31 },
    { key: 'report', votes: 10 },
  ],
  confidences: [
    { key: 'low', votes: 9 },
    { key: 'medium', votes: 41 },
    { key: 'high', votes: 88 },
  ],
  withComment: 14,
  withExpectedAnswer: 6,
}

function seededState(variant: string | null): { scope: QualityScope; filters: RatingsFilters } {
  const scope: QualityScope = { ...presetRange(30), organizationIds: [], projectIds: [] }
  if (variant !== 'filtered') return { scope, filters: NO_RATINGS_FILTERS }
  return {
    scope: {
      ...scope,
      organizationIds: ['org_arch_buero', 'org_planwerk'],
      projectIds: [SCOPE_PROJECTS[0].id],
    },
    filters: {
      ...NO_RATINGS_FILTERS,
      verdict: 'down',
      reasons: ['inaccurate', 'wrong_source'],
      topics: ['fire_safety'],
      modes: ['shallow'],
      hasComment: true,
    },
  }
}

if (typeof window !== 'undefined') {
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/feedback/answers')) {
      const conversationId = new URL(url, 'http://x').searchParams.get('conversationId') ?? ''
      return new Response(JSON.stringify({ feedback: TURN_STATES[conversationId] ?? [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/platform/answer-feedback/digest')) {
      return new Response(JSON.stringify(DIGEST), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/platform/quality/scope-options')) {
      const params = new URL(url, 'http://x').searchParams
      const orgs = params.getAll('org')
      return json({
        organizations: SCOPE_ORGANIZATIONS,
        organizationsTruncated: false,
        projects: SCOPE_PROJECTS.filter((project) => orgs.includes(project.organizationId)),
        projectsTruncated: false,
      })
    }
    if (url.includes('/api/platform/answer-feedback/options')) {
      const params = new URL(url, 'http://x').searchParams
      const matching = previewTurns(params).length
      return json({ ...OPTIONS, total: params.get('q') === 'nichts' ? 0 : 140 + matching })
    }
    if (url.includes('/api/platform/answer-feedback')) {
      const params = new URL(url, 'http://x').searchParams
      const { start } = scopeBounds(readQualityScope(params))
      const daily = FIXTURE.daily.filter((point) => point.day >= start.toISOString().slice(0, 10))
      const turns = previewTurns(params)
      const windowDays = Math.round((Date.now() - start.getTime()) / 86_400_000)
      return json({ ...FIXTURE, from: params.get('from'), to: params.get('to'), windowDays, daily, turns })
    }
    return real(input, init)
  }
}

const FOOTNOTE_STATES = [
  {
    id: 'af-rest',
    label: 'In Ruhe',
    caption: 'Unter jeder Antwort — quiet bis zum Hover.',
    wide: false,
    answer: 'Für Gebäudeklasse 4 beträgt die maximale Fluchtweglänge 40 m.',
  },
  {
    id: 'af-up',
    label: 'Hilfreich',
    caption: 'Die Stimme ist gespeichert — und damit fertig.',
    wide: false,
    answer: 'Für Gebäudeklasse 4 beträgt die maximale Fluchtweglänge 40 m.',
  },
  {
    id: 'af-down',
    label: 'Nicht hilfreich — Grund wählen',
    caption: 'Die Stimme steht bereits; der Grund ist der zweite, freiwillige Akt.',
    wide: true,
    answer: 'Für Gebäudeklasse 4 beträgt die maximale Fluchtweglänge 40 m.',
  },
  {
    id: 'af-note',
    label: 'Hinweis offen',
    caption: 'Erst nach dem Grund — Senden bleibt bis zum ersten Zeichen deaktiviert und blass.',
    wide: true,
    answer: 'Für Gebäudeklasse 4 beträgt die maximale Fluchtweglänge 40 m.',
  },
  {
    id: 'af-sent',
    label: 'Hinweis gesendet',
    caption: 'Der zweite Akt schließt sich; Stimme und Grund bleiben stehen.',
    wide: true,
    answer: 'Für Gebäudeklasse 4 beträgt die maximale Fluchtweglänge 40 m.',
  },
] as const

function AnswerFeedbackPreview() {
  const params = useSearchParams()
  const [seed] = useState(() => seededState(params.get('variant')))
  const [scope, setScope] = useState<QualityScope>(seed.scope)
  const [filters, setFilters] = useState<RatingsFilters>(seed.filters)
  const scopeOptions = useQualityScopeOptions(scope)
  const dialog = params.get('dialog') === '1'

  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const nameOf = (id: string): string => SCOPE_ORGANIZATIONS.find((org) => org.id === id)?.name ?? id
  const projectOf = (id: string): string => SCOPE_PROJECTS.find((project) => project.id === id)?.name ?? id

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="answer-feedback-preview"
        className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-6 md:px-8 md:py-8"
      >
        <section className="flex flex-col gap-4">
          <header>
            <h1 className="text-xl font-semibold">Antwortqualität</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Plattform → Antwortqualität → Bewertungen, aus Fixtures.
            </p>
          </header>
          <QualityScopeBar scope={scope} onScopeChange={setScope} options={scopeOptions} />
          <AnswerFeedbackHealth
            scope={scope}
            filters={filters}
            onFiltersChange={setFilters}
            onScopeChange={setScope}
            scopeOptions={scopeOptions.options}
          />
          {dialog ? (
            <FeedbackExportDialog
              defaultOpen
              query={{ scope, ratings: filters }}
              organizationName={nameOf}
              projectName={projectOf}
            />
          ) : null}
        </section>

        <section data-testid="answer-feedback-states" className="space-y-3">
          <SectionLabel as="h2">
            Die Fußnote unter der Antwort — jeder Zustand
          </SectionLabel>
          <div className="grid gap-3 md:grid-cols-2">
            {FOOTNOTE_STATES.map((state) => (
              <div
                key={state.id}
                className={`bg-card flex flex-col gap-2 rounded-lg border p-4 ${state.wide ? 'md:col-span-2' : ''}`}
              >
                <SectionLabel as="p">
                  {state.label}
                </SectionLabel>
                <div className="bg-background rounded-lg border px-4 py-3">
                  <p className="text-foreground text-sm leading-relaxed">{state.answer}</p>
                  <div className="mt-2.5">
                    <AnswerFeedback messageId="af-msg" conversationId={state.id} />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">{state.caption}</p>
              </div>
            ))}

            {/* The `compact` placement is NOT rebuilt here. A hand-built meta
                row is a fork of the answer footer, and this one had already
                drifted from it — it carried a confidence chip and a timestamp
                the footer has since moved behind „Antwortdetails", and it never
                carried the copy actions at all. So it showed the resting row
                on a row that no longer exists, and the open disclosure — the
                state that actually broke the footer's layout — was never on it.
                The real thing, in the real card, is one route away. */}
            <div className="bg-card flex flex-col gap-2 rounded-lg border p-4">
              <SectionLabel as="p">
                Kompakt — in der Meta-Zeile der Antwort
              </SectionLabel>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Die Fußnote in der echten Antwort-Fußzeile, in Ruhe und offen:{' '}
                <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                  /dev/chat-turn?variant=feedback-open
                </code>
                . Hier steht die Komponente für sich — die Zeile, die sie tragen muss, steht dort.
              </p>
            </div>
          </div>
        </section>
      </main>
    </I18nProvider>
  )
}

export default function AnswerFeedbackPreviewPage() {
  return (
    <Suspense fallback={null}>
      <AnswerFeedbackPreview />
    </Suspense>
  )
}
