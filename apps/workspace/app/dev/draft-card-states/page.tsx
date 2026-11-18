'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { useChatStore } from '@/features/chat/store'
import { FileDraftCard } from '@/features/cards/components/FileDraftCard'
import type { Conversation } from '@/features/chat/types'
import { Panel } from '../document-draft-card/file-examples'

const PATH = '/drafts/Raumbuch.xlsx'

const FOLDERS = [
  { id: '00000000-0000-4000-8000-0000000000f1', name: '02 Einreichung', parentId: null, path: '02 Einreichung', access: 'write' },
  { id: '00000000-0000-4000-8000-0000000000f2', name: 'Berichte', parentId: null, path: 'Berichte', access: 'write' },
]

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubbedFetch(real: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/folders')) return answer(200, { folders: FOLDERS, rootAccess: 'write' })
    if (url.startsWith('/api/documents/')) return answer(200, { document: { id: 'doc-raumbuch', folderId: FOLDERS[0].id } })
    if (url.includes('/draft/file')) {
      return answer(409, { code: 'CONFLICT', error: 'changed', details: { reason: 'changed-in-project', versionNumber: 3 } })
    }
    return real(input, init)
  }
}

export default function DraftCardStatesPreview() {
  const [ready] = useState(() => {
    if (typeof window !== 'undefined') window.fetch = stubbedFetch(window.fetch.bind(window))
    useChatStore.setState({
      projectId: 'proj-demo',
      currentConversation: {
        id: 'conv-demo',
        messages: [
          { id: 'm-older', cards: [{ type: 'document_draft', title: 'Raumbuch.xlsx', path: '/drafts/Flächen.xlsx', bytes: 9412, version: 2 }] },
          { id: 'm-newer', cards: [{ type: 'document_draft', title: 'Raumbuch.xlsx', path: '/drafts/Flächen.xlsx', bytes: 9604, version: 3 }] },
        ],
      } as unknown as Conversation,
    })
    return true
  })
  if (process.env.NODE_ENV !== 'development') notFound()
  if (!ready) return null

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div data-testid="draft-card-states-preview" className="flex min-h-screen flex-col items-center gap-10 bg-background p-4 sm:p-10">
        <Panel title="Abgelegt" note="Wer ablegt, segnet ab: die Datei liegt im Projekt, wie ein eigener Upload, ohne Freigabeschritt.">
          <FileDraftCard
            title="Raumbuch.xlsx"
            path="/drafts/Raumbuch abgelegt.xlsx"
            bytes={9_604}
            version={1}
            documentId="00000000-0000-4000-8000-000000000002"
            versionId="00000000-0000-4000-8000-0000000000a2"
            versionState="published"
            filedDraftVersion={1}
            cardKey="state-filed"
          />
        </Panel>

        <Panel title="Seit dem Ablegen geändert" note="Der Entwurf wurde nach dem Ablegen neu geschrieben. „Im Projekt aktualisieren“ führt hier zur Meldung unten.">
          <FileDraftCard
            title="Raumbuch.xlsx"
            path={PATH}
            bytes={9_604}
            version={2}
            documentId="00000000-0000-4000-8000-000000000001"
            versionId="00000000-0000-4000-8000-0000000000a1"
            versionState="published"
            filedDraftVersion={1}
            cardKey="state-changed"
          />
        </Panel>

        <Panel title="Aus einem Projektdokument gemacht" note="„Ins Projekt ablegen“ öffnet den Dialog mit beiden Wegen, im Ordner des Quelldokuments.">
          <FileDraftCard
            title="Raumbuch.xlsx"
            path="/drafts/Raumbuch neu.xlsx"
            bytes={9_604}
            version={1}
            derivedFromDocumentId="00000000-0000-4000-8000-000000000003"
            derivedFromName="Raumbuch.xlsx"
            cardKey="state-derived"
            urls={{ rendition: '/dev/no-such-rendition.pdf', download: '/dev/no-such-file' }}
          />
        </Panel>

        <Panel title="Inzwischen überarbeitet" note="Eine Karte aus einer früheren Antwort, deren Entwurf seither neu geschrieben wurde.">
          <FileDraftCard title="Flächen.xlsx" path="/drafts/Flächen.xlsx" bytes={9_412} version={2} cardKey="state-superseded" />
        </Panel>

        <Panel title="Gelöscht, war abgelegt" note="Der Entwurf ist aus dem Chat gelöscht; das abgelegte Dokument bleibt im Projekt.">
          <FileDraftCard
            title="Raumbuch.xlsx"
            path="/drafts/Raumbuch alt.xlsx"
            bytes={9_412}
            version={1}
            documentId="00000000-0000-4000-8000-000000000001"
            versionId="00000000-0000-4000-8000-0000000000a1"
            versionState="published"
            removed
            cardKey="state-removed"
          />
        </Panel>
      </div>
    </I18nProvider>
  )
}
