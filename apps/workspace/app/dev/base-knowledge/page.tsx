'use client'

/**
 * Dev preview for Organisation → Grundlagen des Büros (ADR-0158): the real card
 * over a fetch shim with a confirmed ÖNORM checked this autumn, an MA 37
 * directive whose check is overdue, a commentary never checked, and a proposal
 * read from a freshly uploaded standard. Not linked from anywhere and 404s
 * outside development.
 */

import type { JSX } from 'react'
import { I18nProvider } from '@/i18n'
import { BaseKnowledgeCard } from '@/features/organization/components/base-knowledge-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { BaseKnowledgeEntry, BaseKnowledgeList } from '@/lib/base-knowledge/wire'

const check = (checkedAt: string) => ({ checkedAt, checkedBy: 'user-1', result: 'current' as const, note: null })

function entry(id: string, values: Partial<BaseKnowledgeEntry['values']>, rest: Partial<BaseKnowledgeEntry> = {}): BaseKnowledgeEntry {
  return {
    id,
    editionId: `edition_${id}`,
    copyId: `manifestation_${id}`,
    documentId: `doc_${id}`,
    fileName: `${id}.pdf`,
    status: 'confirmed',
    proposedBy: 'person',
    textUse: 'used',
    aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T08:00:00.000Z',
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600:2017',
      editionLabel: '2017-04-01',
      issuedOn: '2017-04-01',
      territoryIds: [],
      issuer: 'Austrian Standards',
      addressees: [],
      licenceClass: 'licensed',
      ...values,
    },
    freshness: { intervalDays: 365, lastCheck: check('2026-10-02T09:00:00.000Z'), dueAt: '2027-10-02T09:00:00.000Z', overdue: false },
    ...rest,
  }
}

const LIST: BaseKnowledgeList = {
  enabled: true,
  canManage: true,
  nextCursor: null,
  entries: [
    entry(
      'oenorm-b-1300',
      { designation: 'ÖNORM B 1300:2018', title: 'Objektsicherheitsprüfungen für Wohngebäude', editionLabel: '2018-11-01' },
      { status: 'proposed', proposedBy: 'reading', fileName: 'OENORM_B_1300_2018-11-01.pdf', freshness: { intervalDays: 365, lastCheck: null, dueAt: null, overdue: true } },
    ),
    entry('oenorm-b-1600', {}),
    entry(
      'oenorm-b-5371',
      { designation: 'ÖNORM B 5371:2021', title: 'Treppen, Geländer und Brüstungen', editionLabel: '2021-01-15' },
      { textUse: 'metadata_only', aiProcessingAttestedAt: null },
    ),
    entry(
      'ma37',
      {
        kind: 'authority_directive',
        designation: null,
        title: 'Weisung Dachgeschoßausbau',
        editionLabel: '2021-03-15',
        territoryIds: ['AT-9'],
        addressees: [{ name: 'MA 37', territoryId: 'AT-9' }],
        licenceClass: 'public_open',
      },
      { freshness: { intervalDays: 180, lastCheck: check('2025-12-01T09:00:00.000Z'), dueAt: '2026-05-30T09:00:00.000Z', overdue: true } },
    ),
    entry(
      'kommentar',
      { kind: 'commentary', designation: null, title: 'Bauordnung für Wien, Kommentar', editionLabel: '2019' },
      { freshness: { intervalDays: 365, lastCheck: null, dueAt: null, overdue: true } },
    ),
  ],
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __baseKnowledgeShim?: boolean }
  if (!w.__baseKnowledgeShim) {
    w.__baseKnowledgeShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith('/api/base-knowledge')) return Response.json(LIST)
      if (url.startsWith('/api/documents?scope=office_shelf')) {
        return Response.json({ documents: [{ id: 'doc_new', filename: 'DIN_4109-1_2018-01.pdf', displayName: null }] })
      }
      return real(input, init)
    }
  }
}

export default function BaseKnowledgeDevPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="mx-auto max-w-3xl p-8" data-testid="base-knowledge-preview">
        <Card>
          <CardHeader>
            <CardTitle>Grundlagen des Büros</CardTitle>
            <CardDescription>Vorschau mit Beispieldaten</CardDescription>
          </CardHeader>
          <CardContent>
            <BaseKnowledgeCard />
          </CardContent>
        </Card>
      </main>
    </I18nProvider>
  )
}
