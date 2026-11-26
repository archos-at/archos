'use client'

import type { JSX } from 'react'
import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { PERSONAL_CHAT_PATH, PERSONAL_SHELF_PATH } from '@/components/shell/rail-mode'
import { recordRecentProject } from '@/components/shell/recent-projects'
import { PersonalShelfWorkspace } from '@/features/documents/components/personal-shelf-workspace'
import type { FileItem, FolderItem } from '@/features/documents/file-types'
import { installConnectionHealthFake } from '../_fixtures/connection-health'
import { installInboxBadgeFake } from '../_fixtures/inbox-badge'
import { I18nProvider } from '@/i18n'
import { DevRailChats } from '../_fixtures/rail-chats'

installInboxBadgeFake(2)
installConnectionHealthFake()

const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
]
const USER = { name: 'Anna Berger', email: 'a.berger@huber-architektur.at' }
const ORGANIZATION = 'Huber Architektur ZT GmbH'

const file = (id: string, filename: string, summary: string, folderId: string | null): FileItem => ({
  id,
  filename,
  displayName: null,
  fileSize: 1_800_000,
  contentType: 'application/pdf',
  status: 'ready',
  folderId,
  createdAt: '2026-11-20T09:00:00Z',
  errorMessage: null,
  summary,
  pageCount: 12,
  chunkCount: 30,
  contentTypes: ['text'],
  tags: [],
  topics: null,
  capture: null,
})

const folder = (id: string, name: string): FolderItem => ({
  id,
  parentId: null,
  name,
  path: name,
  createdAt: '2026-11-01T09:00:00Z',
  updatedAt: '2026-11-01T09:00:00Z',
})

const FOLDERS: FolderItem[] = [folder('f-wettbewerb', 'Wettbewerbe'), folder('f-vorlagen', 'Vorlagen und Checklisten')]
const FILES: FileItem[] = [
  file('d1', 'Anfrage_Huber_Dachausbau.pdf', 'Anfrage eines Bauherrn, noch kein Projekt.', null),
  file('d2', 'Auslobung_Wettbewerb_Volksschule.pdf', 'Auslobungsunterlagen des offenen Wettbewerbs.', 'f-wettbewerb'),
  file('d3', 'Checkliste_Einreichung_Wien.pdf', 'Eigene Checkliste für Einreichungen in Wien.', 'f-vorlagen'),
]

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function answer(url: string, method: string): Response | null {
  const path = new URL(url, window.location.origin).pathname
  if (/\/api\/documents\/.+\/thumbnail$/.test(path)) return new Response(null, { status: 404 })
  if (path === '/api/documents' && method === 'GET') return json({ documents: FILES, collectionName: 'personal_dev', canManage: true, nextCursor: null })
  if (path === '/api/personal-shelf/folders' && method === 'GET') return json({ folders: FOLDERS })
  return null
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  recordRecentProject('p-1')
  const w = window as unknown as { __personalAreaShim?: boolean }
  if (!w.__personalAreaShim) {
    w.__personalAreaShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return answer(url, init?.method ?? 'GET') ?? real(input, init)
    }
  }
}

function PersonalAreaPreview(): JSX.Element {
  const params = useSearchParams()
  const project = params?.get('mode') === 'project'
  const pathname = project ? '/app/projects/p-1/files' : params?.get('active') === 'chat' ? `${PERSONAL_CHAT_PATH}?session=chat-2` : PERSONAL_SHELF_PATH
  return (
    <DevRailChats pathname={pathname.split('?')[0]}>
      <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row" data-testid="personal-area-preview">
        <AppSidebar
          projectId={project ? 'p-1' : null}
          projects={PROJECTS}
          pathname={pathname.split('?')[0]}
          user={USER}
          organizationName={ORGANIZATION}
          authRequired={false}
          canViewOrganization
          canAccessOfficeShelf
          canAccessInbox
          showSkills
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {!project && <PersonalShelfWorkspace userId="dev-user" />}
        </div>
      </div>
    </DevRailChats>
  )
}

export default function PersonalAreaDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Suspense fallback={null}>
        <PersonalAreaPreview />
      </Suspense>
    </I18nProvider>
  )
}
