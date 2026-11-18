import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { FIELD_FOCUS_RING, FIELD_FOCUS_WITHIN_RING, FOCUS_RING } from './focus-ring'
import { Input } from './input'
import { Textarea } from './textarea'
import { Select, SelectTrigger } from './select'
import { TagInput } from './tag-input'
import { InputArea } from '@/features/layout/components/InputArea'

vi.mock('@/features/chat', () => ({
  useWebSocketChat: vi.fn(() => ({
    sendMessage: vi.fn(),
    isStreaming: false,
    isLoading: false,
    respondToInteraction: vi.fn(),
    noteSendIntent: vi.fn(),
    pendingInteraction: null,
  })),
  useIsCurrentSessionBusy: vi.fn(() => false),
}))

vi.mock('@/features/chat/store', () => {
  const state = () => ({
    currentConversation: { id: 'session-1', messages: [] },
    conversations: [{ id: 'session-1', messages: [] }],
    saveDataSourcesToConversation: vi.fn(),
    isStreaming: false,
    stopStreaming: vi.fn(),
    ensureSession: vi.fn(() => 'session-1'),
    _ensureConversationExists: vi.fn(async () => {}),
    startNewSessionDraft: vi.fn(),
    setRespondToInteractionFn: vi.fn(),
    setChatSendFn: vi.fn(),
    composerPrefill: null,
    consumeComposerPrefill: vi.fn(() => null),
    composerSubject: null,
    setComposerSubject: vi.fn(),
    composerDrafts: {},
    getComposerDraft: () => '',
    setComposerDraft: vi.fn(),
    clearComposerDraft: vi.fn(),
  })
  return { useChatStore: Object.assign(vi.fn((selector: (s: ReturnType<typeof state>) => unknown) => selector(state())), { getState: state }) }
})

vi.mock('@/features/layout/store', () => {
  const state = () => ({
    setDataSourcesPanelTab: vi.fn(),
    setDataSourcePanelTab: vi.fn(),
    enabledDataSourceIds: [],
    knowledgeLayerAvailable: true,
    availableDataSources: [],
    activeSourcePreset: null,
    applySourcePreset: vi.fn(),
    toggleDataSource: vi.fn(),
    setEnabledDataSources: vi.fn(),
    fetchDataSources: vi.fn(),
    dataSourcesLoading: false,
    dataSourcesError: null as string | null,
  })
  return { useLayoutStore: Object.assign(vi.fn((selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state())), { getState: state }) }
})

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ idToken: 'test-token', authRequired: true }),
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

vi.mock('@/features/documents', () => ({
  UploadAnywayButton: () => null,
  useFileUpload: vi.fn(() => ({
    uploadFiles: vi.fn(),
    sessionFiles: [],
    deleteFile: vi.fn(),
    retryFile: vi.fn(),
    isUploading: false,
    error: null,
    clearError: vi.fn(),
  })),
  useFileDragDrop: vi.fn(() => ({
    isDragging: false,
    isUnsupportedDrag: false,
    refusal: null,
    dragHandlers: { onDragEnter: vi.fn(), onDragLeave: vi.fn(), onDragOver: vi.fn(), onDrop: vi.fn() },
  })),
}))

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useMentionCandidates: vi.fn(() => ({ data: null, loading: false, restart: vi.fn() })),
  useAwaitingState: vi.fn(() => ({ awaiting: null, refresh: vi.fn(), release: vi.fn() })),
}))

const classesOf = (element: Element): string => element.getAttribute('class') ?? ''

function expectRecipe(element: Element, recipe: string): void {
  expect([...element.classList]).toEqual(expect.arrayContaining(recipe.split(' ')))
}

function expectNoOwnRing(element: Element): void {
  expect(classesOf(element)).not.toMatch(/focus-(visible|within):ring-(\d|\[)/)
}

describe('field focus', () => {
  it.each([
    ['FIELD_FOCUS_RING', FIELD_FOCUS_RING],
    ['FIELD_FOCUS_WITHIN_RING', FIELD_FOCUS_WITHIN_RING],
  ])('%s turns the border ink and draws no ring or outline', (_, recipe) => {
    expect(recipe).toMatch(/:border-ring\b/)
    expect(recipe).not.toMatch(/ring-(\d|\[)/)
    expect(recipe).toMatch(/outline-hidden!/)
  })

  it('the control ring is untouched: buttons keep their offset ring', () => {
    expect(FOCUS_RING).toContain('focus-visible:ring-2')
  })

  it('Input composes FIELD_FOCUS_RING and spells no focus ring of its own', () => {
    const { container } = render(createElement(Input))
    const field = container.querySelector('input') as HTMLElement
    expectRecipe(field, FIELD_FOCUS_RING)
    expectNoOwnRing(field)
  })

  it('Textarea composes FIELD_FOCUS_RING and spells no focus ring of its own', () => {
    const { container } = render(createElement(Textarea))
    const field = container.querySelector('textarea') as HTMLElement
    expectRecipe(field, FIELD_FOCUS_RING)
    expectNoOwnRing(field)
  })

  it('Select trigger composes FIELD_FOCUS_RING and spells no focus ring of its own', () => {
    const { container } = render(createElement(Select, null, createElement(SelectTrigger)))
    const field = container.querySelector('[data-slot="select-trigger"]') as HTMLElement
    expectRecipe(field, FIELD_FOCUS_RING)
    expectNoOwnRing(field)
  })

  it('TagInput composes FIELD_FOCUS_WITHIN_RING and spells no focus ring of its own', () => {
    const { container } = render(
      createElement(TagInput, { value: ['alpha'], onChange: vi.fn(), removeLabel: (tag: string) => `remove ${tag}` })
    )
    const field = container.querySelector('[data-slot="tag-input"]') as HTMLElement
    expectRecipe(field, FIELD_FOCUS_WITHIN_RING)
    expectNoOwnRing(field)
  })

  it('InputArea composes FIELD_FOCUS_WITHIN_RING on its composer card and spells no focus ring of its own', () => {
    render(createElement(InputArea, { isAuthenticated: true }))
    const card = screen.getByRole('textbox').closest<HTMLElement>('[class~="@container"]')
    expect(card).not.toBeNull()
    expectRecipe(card as HTMLElement, FIELD_FOCUS_WITHIN_RING)
    expectNoOwnRing(card as HTMLElement)
  })
})
