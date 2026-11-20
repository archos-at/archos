'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { FileDraftCard } from '@/features/cards/components/FileDraftCard'
import { DocumentDraftCard } from '@/features/cards/components/DocumentDraftCard'
import { SaveToProjectDialog, type SaveToProjectChoice } from '@/features/documents/save-to-project'
import { I18nProvider } from '@/i18n'
import { Panel } from '../document-draft-card/file-examples'
import { AREA_SCHEDULE_PDF } from '../document-draft-card/sample-files'

const PROJECT = 'proj-demo'
const CONVERSATION = 'conv-demo'

const FOLDERS = [
  { id: 'f-01', name: '01 Entwurf', parentId: null, path: '01 Entwurf', access: 'write' as const },
  { id: 'f-02', name: '02 Einreichung', parentId: null, path: '02 Einreichung', access: 'write' as const },
  { id: 'f-02a', name: 'Flächen', parentId: 'f-02', path: '02 Einreichung/Flächen', access: 'write' as const },
  { id: 'f-02b', name: 'Brandschutz', parentId: 'f-02', path: '02 Einreichung/Brandschutz', access: 'write' as const },
  { id: 'f-03', name: 'Berichte', parentId: null, path: 'Berichte', access: 'write' as const },
  { id: 'f-04', name: 'Verträge', parentId: null, path: 'Verträge', access: 'read' as const },
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __saveToProjectShim?: boolean }
  if (!w.__saveToProjectShim) {
    w.__saveToProjectShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === `/api/projects/${PROJECT}/folders` && method === 'GET') {
        return Response.json({ folders: FOLDERS, rootAccess: 'write' })
      }
      if (url === `/api/projects/${PROJECT}/folders` && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { name: string; parentId?: string }
        const folder = { id: `f-${Date.now()}`, name: body.name, parentId: body.parentId ?? null, path: body.name }
        FOLDERS.push({ ...folder, access: 'write' })
        return Response.json({ folder }, { status: 201 })
      }
      if (url === `/api/conversations/${CONVERSATION}/draft/file`) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { folderId?: string | null }
        const folder = FOLDERS.find((candidate) => candidate.id === body.folderId)
        await new Promise((resolve) => setTimeout(resolve, 600))
        return Response.json(
          {
            documentId: '00000000-0000-4000-8000-000000000001',
            versionId: '00000000-0000-4000-8000-0000000000a1',
            state: 'draft',
            alreadyFiled: false,
            folderId: folder?.id ?? null,
            folderName: folder?.name ?? (body.folderId === undefined ? 'Berichte' : null),
          },
          { status: 201 },
        )
      }
      return real(input, init)
    }
  }
}

export default function SaveToProjectPreview() {
  if (process.env.NODE_ENV !== 'development') notFound()
  useChatStore.setState({
    projectId: PROJECT,
    currentConversation: { id: CONVERSATION, messages: [] } as unknown as Conversation,
  })
  const [open, setOpen] = useState(true)
  const [chosen, setChosen] = useState<SaveToProjectChoice | null>(null)

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div data-testid="save-to-project-preview" className="bg-background flex min-h-screen flex-col items-center gap-10 p-4 sm:p-10">
        <Panel
          title="Ins Projekt ablegen: wohin und unter welchem Namen"
          note="Der Dialog für jede Datei, die ins Projekt soll: oben der Name mit seiner festen Endung, darunter der Ort als Pfad und die Ordner, die dort liegen. Ein Ordner öffnet sich mit einem Klick; abgelegt wird, wo man steht. In einem Ordner, den man nur lesen darf, bleibt „Ablegen“ gesperrt und der Dialog sagt warum."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setOpen(true)} data-testid="save-to-project-preview-open">
              Dialog öffnen
            </Button>
            {chosen && (
              <span className="text-muted-foreground text-sm" data-testid="save-to-project-preview-choice">
                {chosen.name} → {chosen.folderLabel}
              </span>
            )}
          </div>
          <SaveToProjectDialog
            open={open}
            onOpenChange={setOpen}
            projectId={PROJECT}
            fileName="Flächenaufstellung Top 4.xlsx"
            extension="xlsx"
            initialFolderId="f-02"
            onSave={(choice) => {
              setChosen(choice)
              setOpen(false)
            }}
          />
        </Panel>

        <Panel
          title="Aus der Datei-Karte"
          note="„Ins Projekt ablegen“ öffnet denselben Dialog. Danach sagt die Karte, in welchem Ordner die Datei als Entwurf liegt."
        >
          <FileDraftCard
            title="Flächenaufstellung Top 4"
            path="/drafts/Flächenaufstellung Top 4.xlsx"
            bytes={9_412}
            version={1}
            cardKey="document_draft-save-0"
            urls={{ rendition: AREA_SCHEDULE_PDF, download: AREA_SCHEDULE_PDF }}
          />
        </Panel>

        <Panel title="Aus der Markdown-Karte" note="Derselbe Dialog; die Endung ist .md, weil der Entwurf als Markdown abgelegt wird.">
          <DocumentDraftCard
            title="Aktenvermerk – Abweichung Fluchtweglänge"
            path="/entwuerfe/aktenvermerk-fluchtweg.md"
            bytes={4820}
            version={3}
            cardKey="document_draft-save-1"
          />
        </Panel>
      </div>
    </I18nProvider>
  )
}
