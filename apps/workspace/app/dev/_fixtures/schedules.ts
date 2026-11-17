import type { Job } from '@/adapters/api/jobs-client'

const base = {
  projectId: 'p1',
  skillName: null,
  dataSources: null,
  scheduleTimezone: 'Europe/Vienna',
  dueAt: null,
  lastRunAt: null,
  createdBy: 'user_1',
  createdAt: '2026-07-01T09:00:00Z',
  updatedAt: '2026-08-01T09:00:00Z',
} satisfies Omit<
  Job,
  'id' | 'name' | 'prompt' | 'output' | 'enabled' | 'scheduleCron' | 'nextRunAt'
>

export const SCHEDULE_SKILL = {
  name: 'schallschutz-bericht',
  description: 'Verfasst den Schallschutz-Nachweis nach OIB-Richtlinie 5.',
  body: [
    'Handle als Bauphysiker und erstelle den Schallschutz-Nachweis nach OIB-Richtlinie 5.',
    '',
    '1. Ermittle aus den Projektunterlagen jedes trennende Bauteil und seine Aufbauten.',
    '2. Vergleiche die erreichten Werte mit den Anforderungen der OIB-Richtlinie 5.',
    '3. Nenne jede Unterschreitung mit Bauteil, Sollwert, Istwert und Fundstelle.',
  ].join('\n'),
  metadata: { 'grid-agents': 'deep_researcher' },
  origin: 'org' as const,
}

export const SCHEDULES: Job[] = [
  {
    ...base,
    id: 'j1',
    name: 'Täglicher Brandschutz-Scan',
    prompt:
      'Prüfe die aktuellen Projektunterlagen auf offene Brandschutzpunkte und nenne jede Abweichung mit der OIB-Fundstelle.',
    output: 'chat',
    enabled: true,
    scheduleCron: '0 6 * * *',
    nextRunAt: null,
  },
  {
    ...base,
    id: 'j2',
    name: 'Monatlicher Schallschutz-Nachweis',
    prompt: [
      '/schallschutz-bericht — fasse den Stand des Nachweises für dieses Projekt zusammen.',
      '',
      'Gehe dabei Geschoss für Geschoss vor und nenne für jedes trennende Bauteil,',
      'welche Unterlage den Nachweis belegt — und wo noch keine vorliegt.',
    ].join('\n'),
    skillName: SCHEDULE_SKILL.name,
    dataSources: ['ris'],
    output: 'deep-research',
    enabled: true,
    scheduleCron: '0 6 1 * *',
    nextRunAt: null,
  },
  {
    ...base,
    id: 'j3',
    name: 'Einreichcheck Montagfrüh',
    prompt: 'Was fehlt noch für die Einreichung? Liste jeden offenen Punkt mit Zuständigem.',
    output: 'deep-research',
    enabled: true,
    scheduleCron: '0 6 * * 1',
    nextRunAt: null,
  },
  {
    ...base,
    id: 'j4',
    name: 'Nachmittags-Statusnotiz',
    prompt: 'Fasse zusammen, was sich heute in den Projektunterlagen geändert hat.',
    output: 'chat',
    enabled: true,
    scheduleCron: '30 16 * * 2,4',
    nextRunAt: null,
  },
  {
    ...base,
    id: 'j5',
    name: 'Bestandsplan-Abgleich (pausiert)',
    prompt: 'Gleiche den Bestandsplan mit dem eingereichten Einreichplan ab.',
    output: 'chat',
    enabled: false,
    scheduleCron: '0 9 * * 3',
    nextRunAt: null,
  },
  {
    ...base,
    id: 'j6',
    name: 'Normprüfung auf Zuruf',
    prompt: 'Prüfe die aktuelle Planung gegen die geltenden OIB-Richtlinien.',
    output: 'deep-research',
    enabled: true,
    scheduleCron: null,
    nextRunAt: null,
  },
  {
    ...base,
    id: 'j7',
    name: 'Einreichprüfung vor der Abgabe',
    prompt: 'Prüfe die Einreichplanung auf Vollständigkeit vor der Abgabe am Freitag.',
    output: 'chat',
    enabled: true,
    scheduleCron: null,
    dueAt: '2026-09-17T13:00:00Z',
    nextRunAt: '2026-09-17T13:00:00Z',
  },
  {
    ...base,
    id: 'j8',
    name: 'Fristencheck Bauverhandlung',
    prompt: 'Prüfe die Fristen für die Bauverhandlung und fasse sie zusammen.',
    output: 'chat',
    enabled: true,
    scheduleCron: null,
    dueAt: '2026-09-15T07:00:00Z',
    nextRunAt: null,
    lastRunAt: '2026-09-15T07:00:04Z',
  },
]

export function installScheduleShim(flag: string): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  const w = window as unknown as Record<string, boolean | undefined>
  if (w[flag]) return
  w[flag] = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/api/skills/invocable')) {
      return Response.json({
        skills: [{ name: SCHEDULE_SKILL.name, description: SCHEDULE_SKILL.description, origin: 'org' }],
      })
    }
    if (url.includes('/data_sources')) {
      return Response.json({
        data_sources: [
          { id: 'web_search', name: 'Websuche', description: 'Aktuelle Treffer aus dem Web' },
          { id: 'ris', name: 'RIS-Rechtstexte', description: 'Geltendes österreichisches Recht' },
        ],
        knowledge_layer: true,
        vlm_available: false,
      })
    }
    if (url.includes('/runs')) return Response.json({ runs: [], nextCursor: null })
    if (url.includes('/tasks') && !url.includes('/run')) {
      return Response.json({ tasks: SCHEDULES, nextCursor: null })
    }
    return real(input, init)
  }
}
