'use client'

/**
 * Dev preview of the Postfach docked beside the page (ADR-0148): the real
 * shell (`AppShellChrome`) with the real `InboxDock` in its start slot, served
 * by the shared fixture inbox. No backend, so the page beside the dock is a
 * stand-in that says what goes there; in the product it is the entry's own
 * place, the chat at the message or the review at the mark.
 *
 * The shell stands inside a project, where the Postfach docks beside the rail.
 * `?scope=org` shows it above a project (the projects list): nothing docks
 * there and the header's bell is a link to the Postfach's dialog.
 *
 * `?dock=closed` shows the same shell with the dock put away, which is how a
 * reader without it sees the page. `?page=file` opens the real file preview
 * over the page, as an entry about a mark does: it covers the page from the
 * dock's edge (`--page-inset-start`) and leaves the dock in view and usable.
 * Its document cannot load here (no backend); its frame is what is shown.
 * `?page=chat` puts the real chat beside the dock, as following a chat entry
 * does: the real `ChatArea` on the shared-thread preview's conversation, under
 * the chat's own header. `?chats=empty` is a project nobody has chatted in, so
 * the rail lists no chats and the header keeps its door to the history.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { AppShellChrome } from '@/components/shell/app-shell-chrome'
import { useStartDock } from '@/components/shell/start-dock'
import { InboxDock } from '@/features/collaboration/components'
import { NO_TOURS } from '@/lib/onboarding/product-tour'
import { FilePreviewHost } from '@/features/documents/components/file-preview-host'
import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { ChatArea } from '@/features/layout/components'
import { useChatStore } from '@/features/chat/store'
import { ChatToolbar } from '@/features/layout/components/ChatToolbar'
import { installInboxShim } from '../_fixtures/inbox-items'
import { DevRailChats, devRailConversations } from '../_fixtures/rail-chats'
import { installSharedThreadShim, seedSharedThread } from '../_fixtures/shared-thread'

/** The document an entry about a mark opens. */
const PLAN: FileItem = {
  id: 'd-eg-c',
  filename: 'Grundriss EG Index C.pdf',
  displayName: null,
  fileSize: 2_458_112,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-10-20T09:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: 1,
  chunkCount: 4,
  contentTypes: ['drawing'],
  tags: [],
  topics: null,
  capture: null,
}

// The shared-thread fixture's project, so the chat beside the dock is one of this project's.
const PROJECT = { id: 'dev', name: 'Wohnbau Seestadt Baufeld D12' }
const PROJECT_PATH = `/app/projects/${PROJECT.id}/chat`

const config: AppConfig = { authRequired: false, fileUpload: getFileUploadConfigFromEnv() }

installInboxShim()
installSharedThreadShim()

export default function InboxDockPreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  // Opened after mount, as a reader's click would: the server renders the dock closed.
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState<string | null>(null)
  const [pathname, setPathname] = useState(PROJECT_PATH)
  const [noChats, setNoChats] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setPage(params.get('page'))
    if (params.get('scope') === 'org') setPathname('/app/projects')
    setNoChats(params.get('chats') === 'empty')
    if (params.get('dock') !== 'closed') useStartDock.getState().open('inbox')
    if (params.get('page') === 'chat') {
      // The thread replaces the store's chats; the rail's go back in beside it, as this reader's own.
      seedSharedThread()
      if (params.get('chats') !== 'empty') {
        useChatStore.setState((state) => ({
          conversations: [...state.conversations, ...devRailConversations(PROJECT.id, state.currentUserId ?? '')],
        }))
      }
    }
    if (params.get('page') === 'file')
      useFilePreviewStore.getState().open(PLAN, 'modal', { projectId: PROJECT.id })
    setReady(true)
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <AppConfigProvider config={config}>
        <DevRailChats pathname={pathname} empty={noChats}>
        <AppShellChrome
          pathname={pathname}
          projects={[PROJECT]}
          user={{ name: 'Miriam Hofer', email: 'miriam@buero.at' }}
          organizationName="Architekturbüro Nord"
          authRequired={false}
          canManageOrganization={false}
          canViewOrganization={false}
          canManagePlatform={false}
          canAccessOfficeShelf
          canAccessInbox
          showSkills={false}
          showModels={false}
          tours={NO_TOURS}
          overlay={null}
          startDock={ready ? { inbox: <InboxDock /> } : {}}
        >
          <main
            id="main-content"
            className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          >
            {ready && <FilePreviewHost />}
            {page === 'chat' ? (
              ready && (
                <>
                  {/* The chat's own header, as `MainLayout` mounts it: beside a rail
                      that lists the chats it has no history door (`?chats=empty` is a
                      rail that lists none, and the door is back). */}
                  <ChatToolbar sessionTitle="Rettungsweg über das nördliche Treppenhaus" />
                  <ChatArea isAuthenticated canCollaborate />
                </>
              )
            ) : (
              <div
                className="m-auto max-w-md space-y-2 p-8 text-center"
                data-testid="inbox-dock-page"
              >
                <p className="text-sm font-semibold">
                  Hier steht die Seite, die ein Eintrag öffnet
                </p>
                <p className="text-muted-foreground text-sm">
                  Der Chat an der Nachricht oder die Prüfansicht an der Anmerkung, mit allem, was
                  sie können. Das Postfach bleibt daneben.
                </p>
              </div>
            )}
          </main>
        </AppShellChrome>
        </DevRailChats>
      </AppConfigProvider>
    </I18nProvider>
  )
}
