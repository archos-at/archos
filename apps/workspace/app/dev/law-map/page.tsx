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
const SUMMARY = { id: REQUEST_ID, title: 'Austria: Länder, building laws, OIB-Richtlinien and their adoption per Land', countryId: 'AT', status: 'submitted', createdBy: 'user_a', createdAt: '2026-11-10T16:42:01Z', origin: 'operator', sourceRecordId: null, monitorFinding: null, approval: 'four_eyes', secondReview: null, revisionCount: LAW_MAP_AT_REVISIONS.length }
const VIEW = { ...SUMMARY, submittedAt: '2026-11-10T17:00:00Z', publishedAt: null, revisions: LAW_MAP_AT_REVISIONS, texts: [], captures: [], sourcesUnchecked: false, secondReviewRoles: [], approvals: [], releases: [] }

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __lawMapShim?: boolean }
  if (!w.__lawMapShim) {
    w.__lawMapShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith('/api/platform/knowledge/change-requests?countryId=')) return Response.json({ changeRequests: [SUMMARY], nextCursor: null })
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
