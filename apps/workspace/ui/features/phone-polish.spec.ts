import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { shelfGet } from '@/test-utils/shelf-handlers'
import { DECISION_BUTTON, DECISION_ROW } from '@/features/cards/components/card-chrome'
import { useChatStore } from '@/features/chat/store'
import { useEffortStore } from '@/features/chat/stores/effort-store'
import { AgentPrompt } from '@/features/chat/components/AgentPrompt'
import { EffortDial, resetEffortDialDefaultRequest } from '@/features/chat/components/effort-dial/EffortDial'
import { ViewerToolButton } from '@/features/bim/components/viewer/viewer-tool-button'
import { OfficeShelfWorkspace } from '@/features/documents/components/office-shelf-workspace'
import { InboxSheet } from '../../app/app/(shell)/inbox/inbox-sheet'

const classesOf = (text: string): string[] => text.split(/\s+/).filter(Boolean)

const INBOX_PAD = 'pb-[max(1.5rem,env(safe-area-inset-bottom))]'
const ARCHIV_PAD = 'pb-[env(safe-area-inset-bottom)]'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/office-shelf',
  useSearchParams: () => new URLSearchParams(''),
  notFound: () => {
    throw new Error('notFound')
  },
}))

vi.mock('@/lib/auth/require-auth', () => ({
  withPageSession: (run: (session: { userId: string }) => unknown) => run({ userId: 'user-1' }),
}))

vi.mock('@/lib/authz/feature-flags', () => ({
  isCollaborationEnabled: () => true,
}))

vi.mock('@/lib/inbox/registry', () => ({
  inboxIsReachable: () => true,
}))

vi.mock('@/i18n/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

vi.mock('@/components/shell/route-page-sheet', () => ({
  RoutePageSheet: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}))

vi.mock('@/features/collaboration/components', () => ({
  InboxList: () => createElement('div', { 'data-testid': 'inbox-list' }),
}))

vi.mock('@/features/documents/hooks/use-office-shelf-documents', () => ({
  useOfficeShelfDocuments: () => ({
    uploadFiles: vi.fn(),
    cancelUpload: vi.fn(),
    retryFile: vi.fn(),
    trackedFiles: [],
    isUploading: false,
    isPolling: false,
    error: null,
    clearError: vi.fn(),
  }),
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => createElement('div', { 'data-testid': 'markdown' }, content),
}))

vi.mock('@/components/motion/height-arrival', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/motion/height-arrival')>()),
  HeightArrival: ({ children, className }: { children: ReactNode; className?: string }) =>
    createElement('div', { 'data-testid': 'height-arrival', className }, children),
}))

describe('a sheet that reaches the screen edge ends its list above the home indicator', () => {
  it('Inbox', async () => {
    render(await InboxSheet({ standalone: true }))
    const list = screen.getByTestId('inbox-list')
    expect(classesOf(list.parentElement?.className ?? '')).toContain(INBOX_PAD)
  })

  describe('Archiv, which is the Dateien workspace on the office shelf', () => {
    beforeEach(() => {
      server.use(
        http.get('/api/office-shelf/folders', () => HttpResponse.json({ folders: [] })),
        shelfGet('office_shelf', '/api/documents', () =>
          HttpResponse.json({ documents: [], collectionName: 'archiv_org-1', canManage: true }),
        ),
        http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
      )
    })

    it('pads the list foot by the home indicator, with no floating upload button on the desktop', async () => {
      render(createElement(OfficeShelfWorkspace, { canManage: true }))
      await screen.findByTestId('office-shelf-header')
      const scrollers = [...document.querySelectorAll<HTMLElement>('.scroll-fade-bottom')]
      expect(scrollers.some((el) => classesOf(el.className).includes(ARCHIV_PAD))).toBe(true)
    })
  })
})

describe('the phone dock names its tools whole', () => {
  it('keeps the caption at 11px and gives it the width of the tool, with no side padding', () => {
    const Icon = () => null
    render(createElement(ViewerToolButton, { label: 'Messen', caption: 'Messen', icon: Icon }))
    const tool = screen.getByRole('button', { name: 'Messen' })
    expect(classesOf(tool.className)).toEqual(expect.arrayContaining(['text-[11px]', 'px-0', 'py-1.5']))
  })
})

describe('the effort dial arrives through the shared primitive', () => {
  beforeEach(() => {
    resetEffortDialDefaultRequest()
    useEffortStore.setState({ orgDefault: 'medium', draft: null, byConversation: {} })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ settings: { settings: {} } }), { status: 200 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows its maximum warning inside the shared arrival and sets no height of its own', async () => {
    render(createElement(EffortDial, { conversationId: 'c1' }))
    fireEvent.click(screen.getByTestId('effort-dial-trigger'))
    fireEvent.change(await screen.findByTestId('effort-dial-slider'), { target: { value: '4' } })

    const warning = await screen.findByTestId('effort-dial-maximum-warning')
    expect(warning.closest('[data-testid="height-arrival"]')).not.toBeNull()
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      expect(el.style.height).not.toBe('auto')
    }
  })
})

describe('a decision row stacks on a phone', () => {
  it('the plan approval uses the cards’ DECISION_ROW and gives every button its DECISION_BUTTON', () => {
    useChatStore.setState({ respondToInteractionFn: vi.fn() })
    render(
      createElement(AgentPrompt, {
        content:
          '**Research Plan Preview**\n\n**Title:** Brandschutz in Wien\n\n---\n' +
          'Reply **approve** to proceed, **shallow** for a quick answer instead, ' +
          '**cancel** to dismiss, or provide feedback to revise the plan.',
      }),
    )

    const row = screen.getByRole('button', { name: /approve plan/i }).parentElement
    expect(row).not.toBeNull()
    expect(classesOf(row!.className)).toEqual(expect.arrayContaining(classesOf(DECISION_ROW)))
    const buttons = within(row!).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(classesOf(button.className)).toEqual(expect.arrayContaining(classesOf(DECISION_BUTTON)))
    }
  })
})
