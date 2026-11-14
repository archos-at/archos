'use client'

/**
 * Dev preview for the law map: the REAL `LawMapPage` on Austria's pack served
 * as one submitted change request (`_fixtures/law-map-at.ts`). A
 * module-scope fetch shim (browser + dev only) serves the request; 404s
 * outside development (`app/dev/layout.tsx`).
 */

import type { JSX } from 'react'
import { Suspense } from 'react'
import { LawMapPage } from '@/features/platform/components/law-map/law-map-page'
import { LAW_MAP_AT_REVISIONS } from '../_fixtures/law-map-at'

const REQUEST_ID = '5907f5cb-8443-43bd-8b82-02f28d563dfd'

const claims = (body: Record<string, unknown>) => Object.entries(body).map(([path, value]) => ({ path, value, decision: null as string | null }))
const BASE_URL = 'https://www.oib.or.at/sites/default/files/richtlinien/2023'

/** A source and a test question as an operator proposes them, so "everything else" reads in words (addresses illustrative). */
const OTHERS = [
  {
    revisionId: 'rev-source:at-oib',
    recordId: 'source:at-oib',
    type: 'source',
    createdBy: 'user_a',
    citations: [{ url: 'https://www.oib.or.at/de/oib-richtlinien', quote: 'OIB-Richtlinien 2023' }],
    claims: claims({
      title: 'OIB-Richtlinien',
      territoryId: 'AT',
      protocol: 'web_document',
      format: 'pdf_document',
      hosts: ['www.oib.or.at'],
      dataFlow: 'public_only',
      monitorKind: 'none',
      monitorIntervalHours: 24,
      licence: 'public_open',
      config: {
        id: 'at-oib',
        title: 'OIB-Richtlinien',
        hosts: ['www.oib.or.at'],
        terms: { url: 'https://www.oib.or.at/de/impressum', licence: 'public_open', attribution: '© Österreichisches Institut für Bautechnik', checked: '2026-11-10' },
        monitor: { kind: 'none', interval_hours: 24 },
        access: { documents: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `oib-rl-${n}`, url: `${BASE_URL}/oib-rl_${n}_ausgabe_mai_2023.pdf`, title: `OIB-RL ${n}` })) },
        engine: {},
        fixtures: [{ name: 'oib-rl-2', operation: 'document', args: { id: 'oib-rl-2' }, responses: { [`${BASE_URL}/oib-rl_2_ausgabe_mai_2023.pdf`]: { capture_id: '7c0d5a1e-3f43-4b8e-9a51-2d1f6e0b9c11' } }, expect: { min_passages: 30 } }],
      },
    }),
  },
  {
    revisionId: 'rev-golden_case:at-9-escape-route',
    recordId: 'golden_case:at-9-escape-route',
    type: 'golden_case',
    createdBy: 'user_a',
    citations: [],
    claims: claims({
      question: 'Wie lang darf der Fluchtweg bis zum Treppenhaus in einem Wohnhaus der Gebäudeklasse 4 sein?',
      language: 'de-AT',
      context: { territoryId: 'AT-9', facts: { building_class: 'GK4' }, referenceDate: null, note: null },
      expected: { values: [{ label: 'Fluchtweglänge', anyOf: ['40 m'], grounding: 'text' }], edition: null, citations: [{ designation: 'OIB-RL 2', alsoKnownAs: [], locus: 'Pkt. 5.1.1', grounding: 'text' }] },
      mustNot: [{ kind: 'source', id: 'web-copy', sourceKinds: ['web'], naming: [] }],
      tags: [],
    }),
  },
]
const SUMMARY = { id: REQUEST_ID, title: 'Austria: Länder, building laws, OIB-Richtlinien and their adoption per Land', countryId: 'AT', status: 'submitted', createdBy: 'user_a', createdAt: '2026-11-10T16:42:01Z', origin: 'operator', sourceRecordId: null, monitorFinding: null, approval: 'four_eyes', secondReview: null, revisionCount: LAW_MAP_AT_REVISIONS.length + OTHERS.length }
const VIEW = { ...SUMMARY, submittedAt: '2026-11-10T17:00:00Z', publishedAt: null, revisions: [...LAW_MAP_AT_REVISIONS, ...OTHERS], texts: [], captures: [], sourcesUnchecked: false, warnings: [], secondReviewRoles: [], approvals: [], releases: [] }

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __lawMapShim?: boolean }
  if (!w.__lawMapShim) {
    w.__lawMapShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith('/api/platform/knowledge/change-requests?countryId=')) return Response.json({ changeRequests: [SUMMARY], nextCursor: null })
      if (url === '/api/platform/knowledge/sources') return Response.json({ sources: [{ sourceKey: 'at-ris', origin: 'built_in', countryId: 'AT', hosts: [{ host: 'www.ris.bka.gv.at', state: 'active', usableUntil: null }] }], builtInUnavailable: null })
      // A verdict lands on the fixture's claims, so the outline shows it after its reload.
      if (url === `/api/platform/knowledge/change-requests/${REQUEST_ID}/review` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { decisions: { revisionId: string; claimPath: string; decision: string }[] }
        for (const one of body.decisions) {
          const claim = VIEW.revisions.find((revision) => revision.revisionId === one.revisionId)?.claims.find((candidate) => candidate.path === one.claimPath) as { decision: string | null } | undefined
          if (claim) claim.decision = one.decision
        }
        return Response.json({ recorded: body.decisions.length })
      }
      if (url === `/api/platform/knowledge/change-requests/${REQUEST_ID}`) return Response.json(VIEW)
      return real(input, init)
    }
  }
}

export default function LawMapDevPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <Suspense>
        <LawMapPage countryId="AT" today="2026-11-11" />
      </Suspense>
    </div>
  )
}
