import type { JSX } from 'react'
import { type ReactNode } from 'react'
import { AppShellChrome } from '@/components/shell/app-shell-chrome'
import { RailChatsProvider } from '@/features/layout/components/rail-chats-provider'
import { InboxDock } from '@/features/collaboration/components'
import { WhatsNewNoticeInShell } from '@/features/whats-new/components'
import { RouteFocus } from '@/shared/components/route-focus'
import { MainScrollMemory } from '@/components/shell/main-scroll-memory'
import { resolveShellChrome } from '@/lib/shell/chrome'
import { runWithTenantSlot } from '@/lib/db/tenant-context'
import { ShellNormDialog } from './shell-norm-dialog'

export default async function AppShellLayout({
  children,
  overlay,
}: {
  children: ReactNode
  overlay: ReactNode
}): Promise<JSX.Element> {
  const chrome = await runWithTenantSlot(resolveShellChrome)

  return (
    <RailChatsProvider>
    <ShellNormDialog>
    <AppShellChrome
      projects={chrome.projects}
      user={chrome.user}
      organizationName={chrome.organizationName}
      authRequired={chrome.authRequired}
      organizations={chrome.organizations}
      canManageOrganization={chrome.navFlags.canManageOrganization}
      canViewOrganization={chrome.navFlags.canViewOrganization}
      canManagePlatform={chrome.navFlags.canManagePlatform}
      canAccessOfficeShelf={chrome.navFlags.canAccessOfficeShelf}
      canAccessOfficeStandards={chrome.navFlags.canAccessOfficeStandards}
      canAccessInbox={chrome.navFlags.canAccessInbox}
      showSkills={chrome.showSkills}
      showModels={chrome.showModels}
      inboundMail={chrome.inboundMail}
      tours={chrome.tours}
      overlay={overlay}
      startDock={{ inbox: chrome.navFlags.canAccessInbox ? <InboxDock /> : undefined }}
    >
      {/* `relative` is load-bearing for the docked chat panels: they position
          against this box, so "the inner edge of the rail" is true by
          construction rather than by a CSS variable that had to be published on
          `:root` and guessed at.
          `tabIndex={-1}` makes the landmark programmatically focusable so
          RouteFocus can move focus here on client-side section changes. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none"
      >
        <RouteFocus />
        <MainScrollMemory />
        {children}
      </main>
      {/* The newest weekly summary, once (ADR-0156): inside the chrome, so it can wait out a tour. */}
      <WhatsNewNoticeInShell state={chrome.whatsNew} />
    </AppShellChrome>
    </ShellNormDialog>
    </RailChatsProvider>
  )
}
