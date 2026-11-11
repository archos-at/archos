'use client'

/**
 * Dev preview for Platform → Länder (ADR-0165). Renders the REAL
 * CountryKnowledge (the list) on fixture data, or with `?country=AT` the REAL
 * CountryPage (`&section=works|sources|rules|review|quality`, `&empty=1` for a
 * country with nothing yet); with `?country=AT&section=review&request=1` a
 * submitted change request opened in its sheet, with an
 * authority, a std-asi listing and claims half reviewed; with `?request=alone`,
 * a published one its author approved alone, its second review due (ADR-0176);
 * with `?request=draft`, a draft with an edition whose text is attached and one
 * that still waits for its text (ADR-0165, "Texts are attached in the request");
 * with `?country=AT&section=works&add=1`, "Add a document" opened with a URL typed in.
 *
 * A module-scope fetch shim (browser + dev only) serves the overview and the
 * change request. Not linked from anywhere; 404s outside development.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { CountryKnowledge } from '@/features/platform/components/country-knowledge'
import { CountryPage } from '@/features/platform/components/countries/country-page'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'

const REQUEST_ID = '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e'
const ALONE_ID = '5d1c0a7e-2b3f-4e8d-9c6a-7f1e2d3c4b5a'
const DRAFT_ID = '7e2f1b9c-4d3a-4c8e-8b1f-2a6d5c4e3f10'
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
      sourceOrigin: null,
      countsAsFetched: false,
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
      sourceOrigin: 'built_in',
      countsAsFetched: true,
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

const manifestation = (revisionId: string, key: string, corpusFile: string | null) => ({
  revisionId,
  recordId: `manifestation:${key}`,
  type: 'manifestation',
  createdBy: 'user_a',
  citations: [{ captureId: 'cap-oib', quote: 'Ausgabe April 2019, herausgegeben vom OIB', url: 'https://www.oib.or.at/de/oib-richtlinien/richtlinien/2019' }],
  claims: [
    { path: 'editionId', value: `edition:${key.replace(/-text$/, '')}`, decision: null },
    { path: 'licenceClass', value: 'public_open', decision: null },
    { path: 'corpusFile', value: corpusFile, decision: null },
  ],
})

/** A draft: one edition's text fetched from the publisher, the other still to attach. */
const DRAFT = {
  ...REQUEST,
  id: DRAFT_ID,
  title: 'OIB-Richtlinien 2019',
  status: 'draft',
  submittedAt: null,
  sourcesUnchecked: false,
  revisions: [manifestation('d1', 'at-oib-rl-1-2019-text', 'oib-rl-1-2019.pdf'), manifestation('d2', 'at-oib-rl-2-2019-text', null)],
  texts: [
    {
      revisionId: 'd1',
      recordId: 'manifestation:at-oib-rl-1-2019-text',
      editionId: 'edition:at-oib-rl-1-2019',
      corpusFile: 'oib-rl-1-2019.pdf',
      origin: 'url',
      sha256: 'c'.repeat(64),
      bytes: 1_412_338,
      pages: 12,
      sourceId: 'at-oib',
      sourceOrigin: 'released',
      countsAsFetched: true,
      url: 'https://www.oib.or.at/sites/default/files/oib-rl-1-2019.pdf',
      attachedBy: 'user_a',
      attachedAt: '2026-11-11T09:00:00Z',
    },
  ],
}
const DRAFTS = { changeRequests: [{ ...OVERVIEW.queue[0], id: DRAFT_ID, title: DRAFT.title, status: 'draft', revisionCount: 2 }], nextCursor: null }

const text = (corpusFile: string, edition: string, label: string, work: string, released: boolean) => ({
  corpusFile,
  countryId: 'AT',
  recordId: `manifestation:${corpusFile}`,
  editionId: `edition:${edition}`,
  editionLabel: label,
  workTitle: work,
  released,
  changeRequestId: released ? null : DRAFT_ID,
  changeRequestTitle: released ? null : DRAFT.title,
  changeRequestStatus: released ? null : 'draft',
})
const TEXTS = {
  texts: [
    text('oib-rl-1-2023.pdf', 'at-oib-rl-1-2023', 'April 2023', 'OIB-RL 1 Mechanische Festigkeit und Standsicherheit', true),
    text('oib-rl-2-2023.pdf', 'at-oib-rl-2-2023', 'April 2023', 'OIB-RL 2 Brandschutz', true),
    text('oib-rl-1-2019.pdf', 'at-oib-rl-1-2019', 'April 2019', 'OIB-RL 1 Mechanische Festigkeit und Standsicherheit', false),
  ],
  nextCursor: null,
}
const monitor = (failure: string | null, lag: number | null) => ({ kind: 'etag', intervalHours: 24, checkedAt: '2026-11-11T06:00:00Z', okAt: failure ? null : '2026-11-11T06:00:00Z', failure, freshnessLagDays: lag })
const SOURCES = {
  sources: [
    { sourceKey: 'at-ris', origin: 'built_in', recordId: null, countryId: 'AT', state: 'active', changeRequestId: null, hosts: [{ host: 'www.ris.bka.gv.at', state: 'active', usableUntil: null }], dataFlow: 'public_only', monitor: monitor(null, 0), credential: { set: false, hint: null, setAt: null }, openMonitorRequestId: null, fixtures: null },
    { sourceKey: 'at-oib', origin: 'record', recordId: 'source:at-oib', countryId: 'AT', state: 'testing', changeRequestId: DRAFT_ID, hosts: [{ host: 'www.oib.or.at', state: 'testing', usableUntil: '2026-11-18T00:00:00Z' }], dataFlow: 'public_only', monitor: monitor(null, null), credential: { set: false, hint: null, setAt: null }, openMonitorRequestId: null, fixtures: null },
    { sourceKey: 'de-gesetze', origin: 'record', recordId: 'source:de-gesetze', countryId: 'DE', state: 'active', changeRequestId: null, hosts: [{ host: 'www.gesetze-im-internet.de', state: 'active', usableUntil: null }], dataFlow: 'public_only', monitor: monitor('timeout', null), credential: { set: false, hint: null, setAt: null }, openMonitorRequestId: null, fixtures: null },
  ],
  builtInUnavailable: null,
}

const WORKS = {
  works: [
    { workKey: 'at-oib-rl-1', title: 'Mechanische Festigkeit und Standsicherheit', designation: 'OIB-RL 1', kind: 'model_code', editions: [{ editionKey: 'at-oib-rl-1-2023', label: 'April 2023' }] },
    { workKey: 'at-oib-rl-2', title: 'Brandschutz', designation: 'OIB-RL 2', kind: 'model_code', editions: [{ editionKey: 'at-oib-rl-2-2023', label: 'April 2023' }] },
  ],
}
const ADDED = { changeRequestId: DRAFT_ID, changeRequestTitle: DRAFT.title, opened: false, workKey: 'at-oib-rl-1', editionKey: 'at-oib-rl-1-2019', manifestationKey: 'at-oib-rl-1-2019-text', sha256: 'c'.repeat(64) }

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __platformCountriesShim?: boolean }
  if (!w.__platformCountriesShim) {
    w.__platformCountriesShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/platform/knowledge') return Response.json(OVERVIEW)
      if (url.startsWith('/api/platform/knowledge/change-requests?status=draft')) return Response.json(DRAFTS)
      // `?empty=1`: a country nothing has been started for, so every section shows its empty state.
      const empty = new URLSearchParams(window.location.search).get('empty') === '1'
      if (url.startsWith('/api/platform/knowledge/change-requests?countryId=')) {
        return Response.json(empty ? { changeRequests: [], nextCursor: null } : { changeRequests: [...OVERVIEW.queue.filter((one) => one.countryId === 'AT'), DRAFTS.changeRequests[0]], nextCursor: null })
      }
      if (url.endsWith('/works')) return Response.json(WORKS)
      if (url.includes('/countries/') && init?.method === 'POST') return Response.json(ADDED, { status: 201 })
      if (url.startsWith('/api/platform/knowledge/texts')) return Response.json(empty ? { texts: [], nextCursor: null } : TEXTS)
      if (url === '/api/platform/knowledge/sources') return Response.json(empty ? { sources: [], builtInUnavailable: null } : SOURCES)
      if (url.startsWith('/api/platform/knowledge/change-requests/')) {
        if (init?.method === 'POST' && url.includes('/texts')) return Response.json({ text: DRAFT.texts[0], status: 'written', stored: true })
        if (init?.method === 'POST') return Response.json({ recorded: 1 })
        return Response.json(url.includes(ALONE_ID) || url.endsWith('/alone') ? ALONE : url.includes(DRAFT_ID) || url.endsWith('/draft') ? DRAFT : REQUEST)
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
  // `?country=AT` renders that country's page (with `&section=` for a section, `&empty=1` for its empty states).
  const [country, setCountry] = useState<string | null>(null)
  useEffect(() => setCountry(new URLSearchParams(window.location.search).get('country')), [])
  // `?request=1` opens the first request in the queue, `?request=alone` the one approved alone, through the real button.
  // `&add=1` opens "Add a document" through the real button and types a publisher's URL into it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add') !== '1') return
    const open = (): void => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="country-add-document"]')
      if (!button) return void window.setTimeout(open, 100)
      button.click()
      window.setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('#add-document-url')
        if (!input) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'https://www.oib.or.at/sites/default/files/oib-rl-1-2019.pdf')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.focus()
        input.blur()
      }, 300)
    }
    const handle = window.setTimeout(open, 300)
    return () => window.clearTimeout(handle)
  }, [])
  useEffect(() => {
    const which = new URLSearchParams(window.location.search).get('request')
    if (which !== '1' && which !== 'alone') return
    let cancelled = false
    const open = (): void => {
      if (cancelled) return
      const buttons = document.querySelectorAll<HTMLButtonElement>('[data-testid="country-review-waiting"] button')
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
      {country ? (
        <CountryPage countryId={country} />
      ) : (
        <>
          <PageHeader title={t('sections.countries.title')} subtitle={t('sections.countries.subtitle')} />
          <CountryKnowledge />
        </>
      )}
    </main>
  )
}
