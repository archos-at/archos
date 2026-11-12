'use client'

/**
 * The file peek's split INSIDE the shell's, as a project page has it.
 *
 * `/dev/file-ask-split/chat` mounts `FilePreviewBridge` on its own, so its
 * group is the outermost one and measures the whole row at mount. In the
 * product it sits in the page panel of the shell's start-dock split (the
 * Postfach), and a group lays itself out in a layout effect, children first:
 * the file group is first measured while the Postfach panel still stands at its
 * mount size. On a phone that left 30px for it, and every project page came out
 * as a 140px column beside an empty 250px file panel. That preview stayed
 * correct throughout, because it has no outer split; this one has the real
 * `AppShellChrome` around the real `FilePreviewBridge`, so the nesting is the
 * product's. `docked-split.spec.tsx` holds the same shape against the library.
 *
 * The `/chat` in the path is load-bearing, as in the other preview: the peek
 * stands beside a chat route only.
 *
 *   - default      — nothing docked: the page has the whole row, phone or desktop.
 *   - `?peek=open` — a file open beside the page (desktop; a phone has no room).
 *   - `?dock=open` — the Postfach docked at the start edge as well (desktop).
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { I18nProvider } from '@/i18n'
import { AppShellChrome } from '@/components/shell/app-shell-chrome'
import { useStartDock } from '@/components/shell/start-dock'
import { InboxDock } from '@/features/collaboration/components'
import { FilePreviewBridge } from '@/features/documents/components/file-preview-host'
import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { NO_TOURS } from '@/lib/onboarding/product-tour'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { installInboxShim } from '../../../_fixtures/inbox-items'

const FILE: FileItem = {
  id: 'doc-brandschutz',
  filename: 'Brandschutzkonzept_Wohnbau_Nord.pdf',
  displayName: null,
  fileSize: 1_284_096,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-04-02T09:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: 2,
  chunkCount: 12,
  contentTypes: ['text'],
  tags: [],
  topics: null,
  capture: null,
}

const config: AppConfig = { authRequired: false, fileUpload: getFileUploadConfigFromEnv() }

installInboxShim()

export default function FileAskSplitInShellPreview(): JSX.Element {
  // Opened after mount, as a reader's click would: the server renders both closed.
  const [dockable, setDockable] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    useFilePreviewStore.setState({ file: null, mode: 'modal', hidden: false })
    if (params.get('peek') === 'open') useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    if (params.get('dock') === 'open') {
      setDockable(true)
      useStartDock.getState().open('inbox')
    }
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <AppConfigProvider config={config}>
        <AppShellChrome
          projects={[]}
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
          startDock={dockable ? { inbox: <InboxDock /> } : {}}
        >
          <main
            id="main-content"
            className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          >
            <FilePreviewBridge>
              <div className="m-auto max-w-md space-y-2 p-8 text-center" data-testid="file-ask-in-shell-page">
                <p className="text-sm font-medium">Hier steht die Seite des Projekts</p>
                <p className="text-muted-foreground text-sm">
                  Der Chat, die Dateien oder die Einstellungen, über die ganze Breite.
                </p>
              </div>
            </FilePreviewBridge>
          </main>
        </AppShellChrome>
      </AppConfigProvider>
    </I18nProvider>
  )
}
