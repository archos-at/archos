'use client'

/**
 * Dev preview for Platform → countries (ADR-0165). Renders the REAL
 * CountryKnowledge on fixture data: the countries table, the review queue, and
 * (with `?request=1`) a submitted change request opened in its sheet, with an
 * authority, a std-asi listing and claims half reviewed; with `?request=alone`,
 * a published one its author approved alone, its second review due (ADR-0176).
 *
 * A module-scope fetch shim (browser + dev only) serves the overview and the
 * change request. Not linked from anywhere; 404s outside development.
 */

import type { JSX } from 'react'
import { useEffect } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { CountryKnowledge } from '@/features/platform/components/country-knowledge'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'

const REQUEST_ID = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const ALONE_ID = '5d1c0a7e-2b3f-4e8d-9c6a-7f1e2d3c4b5a'
const FOUR_EYES = { approval: 'four_eyes', secondReview: null }
const DUE = { approval: 'single', secondReview: { state: 'due', by: null, at: null } }

const OVERVIEW = {
  countries: [
    { countryId: 'AT', released: { territory: 104, authority: 23, work: 61, edition: 64 }, openRequests: 2, entitledOffices: 14, overdueEditions: 3 },
    { countryId: 'CH', released: {}, openRequests: 0, entitledOffices: 0, overdueEditions: 0 },
    { countryId: 'DE', released: { territory: 17 }, openRequests: 1, entitledOffices: 1, overdueEditions: 0 },
    { countryId: 'LI', released: {}, openRequests: 0, entitledOffices: 0, overdueEditions: 0 },
  ],
  queue: [
    { id: REQUEST_ID, title: 'MA 37 und die ÖNORMen der OIB-RL 4', countryId: 'AT', status: 'submitted', createdBy: 'user_a', createdAt: '2026-11-10T08:00:00Z', revisionCount: 3, ...FOUR_EYES },
    { id: 'c2', title: 'Bayern: Gebiete', countryId: 'DE', status: 'submitted', createdBy: 'user_b', createdAt: '2026-11-09T08:00:00Z', revisionCount: 97, ...FOUR_EYES },
    { id: ALONE_ID, title: 'Liechtenstein: Baugesetz 2026', countryId: 'LI', status: 'published', createdBy: 'user_a', createdAt: '2026-11-08T08:00:00Z', revisionCount: 3, ...DUE },
  ],
}

const REQUEST = {
  id: REQUEST_ID,
  title: 'MA 37 und die ÖNORMen der OIB-RL 4',
  countryId: 'AT',
  status: 'submitted',
  createdBy: 'user_a',
  createdAt: '2026-11-10T08:00:00Z',
  submittedAt: '2026-11-10T09:00:00Z',
  publishedAt: null,
  ...FOUR_EYES,
  secondReviewRoles: [],
  approvals: [],
  releases: [],
  sourcesUnchecked: true,
  captures: [
    {
      captureId: 'cap-ma37',
      changeRequestId: REQUEST_ID,
      basis: 'operator_supplied',
      sourceId: null,
      url: 'https://www.wien.gv.at/kontakte/ma37/',
      finalUrl: null,
      contentType: 'text/plain; charset=utf-8',
      sha256: 'a'.repeat(64),
      bytes: 96,
      textChars: 96,
      retrievedAt: '2026-11-10T08:30:00Z',
    },
    {
      captureId: 'cap-oib',
      changeRequestId: REQUEST_ID,
      basis: 'fetched',
      sourceId: 'at-ris',
      url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006',
      finalUrl: null,
      contentType: 'text/html',
      sha256: 'b'.repeat(64),
      bytes: 812_004,
      textChars: 759_595,
      retrievedAt: '2026-11-10T08:31:00Z',
    },
  ],
  revisions: [
    {
      revisionId: 'r1',
      recordId: 'authority:at-wien-ma37',
      type: 'authority',
      createdBy: 'user_a',
      citations: [{ captureId: 'cap-ma37', quote: 'Magistratsabteilung 37', url: 'https://www.wien.gv.at/kontakte/ma37/' }],
      claims: [
        { path: 'name', value: 'MA 37 Baupolizei', decision: 'accepted' },
        { path: 'functionCodes', value: ['building_permit'], decision: 'accepted' },
        { path: 'seatTerritoryId', value: 'AT-9', decision: null },
        { path: 'competenceTerritoryIds', value: ['AT-9'], decision: null },
      ],
    },
    {
      revisionId: 'r2',
      recordId: 'work:oenorm-b-5371',
      type: 'work',
      createdBy: 'user_a',
      citations: [{ note: 'OIB-RL 4 (2023), Punkt 2.1, Normenverweis' }],
      claims: [
        { path: 'kind', value: 'technical_standard', decision: 'accepted' },
        { path: 'title', value: 'Treppen, Geländer und Brüstungen', decision: 'rejected' },
        { path: 'identifiers', value: { designation: 'ÖNORM B 5371' }, decision: null },
      ],
    },
    {
      revisionId: 'r3',
      recordId: 'edition:oenorm-b-5371-2021',
      type: 'edition',
      createdBy: 'user_a',
      citations: [{ captureId: 'cap-oib', quote: 'ÖNORM B 5371, Ausgabe 2021-01-15' }],
      claims: [
        { path: 'workId', value: 'work:oenorm-b-5371', decision: null },
        { path: 'label', value: '2021-01-15', decision: null },
      ],
    },
  ],
}

/** The same records, published after its author approved it alone; nobody has given the second review yet. */
const ALONE = {
  ...REQUEST,
  ...DUE,
  secondReviewRoles: [{ role: 'domain_expert', state: 'due', by: null, at: null }],
  id: ALONE_ID,
  title: 'Liechtenstein: Baugesetz 2026',
  countryId: 'LI',
  status: 'published',
  publishedAt: '2026-11-08T10:00:00Z',
  approvals: [
    {
      approver: 'user_a',
      role: 'domain_expert',
      decisionSource: 'app',
      decidedAt: '2026-11-08T09:30:00Z',
      overrideReason: 'Einzige Plattformverantwortliche diese Woche; Zweitprüfung folgt.',
    },
  ],
  releases: REQUEST.revisions.map((revision, index) => ({
    seq: index + 1,
    recordId: revision.recordId,
    channel: 'stable',
    action: 'publish',
    toRevisionId: revision.revisionId,
    releasedAt: '2026-11-08T10:00:00Z',
    approval: 'single',
  })),
  revisions: REQUEST.revisions.map((revision) => ({ ...revision, claims: revision.claims.map((claim) => ({ ...claim, decision: null })) })),
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __platformCountriesShim?: boolean }
  if (!w.__platformCountriesShim) {
    w.__platformCountriesShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/platform/knowledge') return Response.json(OVERVIEW)
      if (url.startsWith('/api/platform/knowledge/change-requests/')) {
        if (init?.method === 'POST') return Response.json({ recorded: 1 })
        return Response.json(url.includes(ALONE_ID) ? ALONE : REQUEST)
      }
      return real(input, init)
    }
  }
}

export default function PlatformCountriesDevPage(): JSX.Element {
  return <Preview />
}

function Preview(): JSX.Element {
  const t = useTranslations(platformCopy)
  // `?request=1` opens the first request in the queue, `?request=alone` the one approved alone, through the real button.
  useEffect(() => {
    const which = new URLSearchParams(window.location.search).get('request')
    if (which !== '1' && which !== 'alone') return
    let cancelled = false
    const open = (): void => {
      if (cancelled) return
      const buttons = document.querySelectorAll<HTMLButtonElement>('[data-testid="country-knowledge-queue"] button')
      const button = which === 'alone' ? buttons[buttons.length - 1] : buttons[0]
      if (button) button.click()
      else window.setTimeout(open, 100)
    }
    const handle = window.setTimeout(open, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 md:px-8" data-testid="platform-countries-preview">
      <PageHeader title={t('sections.countries.title')} subtitle={t('sections.countries.subtitle')} />
      <CountryKnowledge />
    </main>
  )
}
