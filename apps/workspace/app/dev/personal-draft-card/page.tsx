'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { useChatStore } from '@/features/chat/store'
import { FileDraftCard } from '@/features/cards/components/FileDraftCard'
import type { Conversation } from '@/features/chat/types'
import { Panel } from '../document-draft-card/file-examples'

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubbedFetch(real: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/draft/file')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { path?: string; force?: boolean }
      if (body.path?.includes('Konflikt') && !body.force) {
        return answer(409, {
          code: 'CONFLICT',
          error: 'same-name',
          details: { reason: 'same-name', documentId: 'doc-mine', displayName: 'OIB-Richtlinie_2_Overview.pptx' },
        })
      }
      return answer(201, {
        documentId: 'doc-personal',
        versionId: 'ver-personal',
        state: 'draft',
        alreadyFiled: false,
        folderId: null,
        folderName: null,
        outcome: 'filed',
        draftVersion: 1,
      })
    }
    return real(input, init)
  }
}

export default function PersonalDraftCardPreview() {
  const [ready] = useState(() => {
    if (typeof window !== 'undefined') window.fetch = stubbedFetch(window.fetch.bind(window))
    useChatStore.setState({
      projectId: null,
      currentConversation: { id: 'conv-personal', messages: [] } as unknown as Conversation,
    })
    return true
  })
  if (process.env.NODE_ENV !== 'development') notFound()
  if (!ready) return null

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div data-testid="personal-draft-card-preview" className="flex min-h-screen flex-col items-center gap-10 bg-background p-4 sm:p-10">
        <Panel title="Persönlicher Chat, noch nicht abgelegt" note="Ohne Projekt legt die Karte in Meine Ablage, nicht ins Projekt.">
          <FileDraftCard
            title="OIB-Richtlinie_2_Overview.pptx"
            path="/drafts/OIB-Richtlinie_2_Overview.pptx"
            bytes={288_000}
            version={1}
            cardKey="personal-new"
            urls={{ rendition: '/dev/no-such-rendition.pdf', download: '/dev/no-such-file' }}
          />
        </Panel>

        <Panel title="Name schon vergeben" note="Ein Klick auf „In Meine Ablage legen“ zeigt die Datei gleichen Namens und bietet einen neuen Namen an.">
          <FileDraftCard
            title="OIB-Richtlinie_2_Overview.pptx"
            path="/drafts/Konflikt.pptx"
            bytes={288_000}
            version={1}
            cardKey="personal-conflict"
            urls={{ rendition: '/dev/no-such-rendition.pdf', download: '/dev/no-such-file' }}
          />
        </Panel>

        <Panel title="In Meine Ablage abgelegt" note="Öffnen führt in Meine Ablage.">
          <FileDraftCard
            title="OIB-Richtlinie_2_Overview.pptx"
            path="/drafts/OIB-Richtlinie_2_Overview abgelegt.pptx"
            bytes={288_000}
            version={1}
            documentId="00000000-0000-4000-8000-000000000002"
            versionId="00000000-0000-4000-8000-0000000000a2"
            versionState="draft"
            filedDraftVersion={1}
            cardKey="personal-filed"
          />
        </Panel>
      </div>
    </I18nProvider>
  )
}
