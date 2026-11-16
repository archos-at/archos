import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useFilePreviewStore } from '../stores/file-preview-store'
import type { FileItem } from './project-file-workspace'

const nav = vi.hoisted(() => ({ pathname: '/app/projects/p1/files' }))
const panel = vi.hoisted(() => ({ calls: [] as string[], sizeInPixels: 320 }))
const declared = vi.hoisted(
  () => ({ current: null as null | Record<string, unknown> }),
)
const declaredChat = vi.hoisted(
  () => ({ current: null as null | Record<string, unknown> }),
)
const separator = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
const group = vi.hoisted(
  () => ({
    onLayoutChanged: null as
      | null
      | ((layout: Record<string, number>, meta: { isUserInteraction: boolean }) => void),
  }),
)

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./file-preview-pane', async () => {
  const React = await import('react')
  return {
    FilePreviewPane: () => React.createElement('div', { 'data-testid': 'file-preview-pane' }),
  }
})

vi.mock('react-resizable-panels', async () => {
  const React = await import('react')
  const handle = {
    collapse: () => panel.calls.push('collapse'),
    expand: () => panel.calls.push('expand'),
    resize: (size: number | string) => panel.calls.push(`resize:${size}`),
    getSize: () => ({ asPercentage: 0, inPixels: panel.sizeInPixels }),
    isCollapsed: false,
    isExpanded: true,
  }
  return {
    usePanelRef: () => React.useRef(handle),
    Group: ({ children, ...rest }: Record<string, unknown> & { children?: unknown }) => {
      group.onLayoutChanged = rest.onLayoutChanged as typeof group.onLayoutChanged
      return React.createElement(
        'div',
        { 'data-slot': 'resizable-panel-group', ...pickDom(rest) },
        children as never,
      )
    },
    Panel: ({ children, id, ...rest }: Record<string, unknown> & { children?: unknown; id?: string }) => {
      if (id === 'file-ask-panel') declared.current = rest
      if (id === 'file-ask-page') declaredChat.current = rest
      return React.createElement(
        'div',
        { 'data-slot': 'resizable-panel', id, ...pickDom(rest) },
        children as never,
      )
    },
    Separator: (rest: Record<string, unknown>) => {
      separator.current = rest
      return React.createElement('div', {
        role: 'separator',
        onDoubleClick: rest.onDoubleClick as (() => void) | undefined,
        ...pickDom(rest),
      })
    },
  }
  function pickDom(props: Record<string, unknown>): Record<string, unknown> {
    const { className, style } = props
    const label = props['aria-label']
    return {
      ...(className ? { className } : {}),
      ...(style ? { style: style as object } : {}),
      ...(label ? { 'aria-label': label } : {}),
    }
  }
})

import { FilePreviewBridge } from './file-preview-host'
import { FILE_PEEK_WIDTH_MAX, FILE_PEEK_WIDTH_MIN } from '../stores/file-preview-store'

const FILE: FileItem = {
  id: 'doc-1',
  filename: 'Brandschutzplan_EG.pdf',
  displayName: null,
  fileSize: 12,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
}

const reset = (): void => {
  panel.calls = []
  panel.sizeInPixels = 320
  declared.current = null
  declaredChat.current = null
  group.onLayoutChanged = null
  separator.current = null
  window.localStorage.clear()
  nav.pathname = '/app/projects/p1/files'
  useFilePreviewStore.setState({
    file: null,
    mode: 'modal',
    hidden: false,
    peekWidth: 320,
    context: {},
  })
}

describe('FilePreviewSplit — the file panel actually opens', () => {
  beforeEach(reset)
  afterEach(reset)

  it('EXPANDS the panel, not just resizes it, when Ask Piloti lands on chat', () => {
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    const { rerender } = render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )
    expect(panel.calls).toEqual(['collapse'])

    panel.calls = []
    nav.pathname = '/app/projects/p1/chat'
    rerender(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(panel.calls).toEqual(['expand', 'resize:320'])
  })

  it('declares its size bounds independently of the split flag', () => {
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(declared.current).toMatchObject({
      defaultSize: 0,
      minSize: FILE_PEEK_WIDTH_MIN,
      maxSize: FILE_PEEK_WIDTH_MAX,
      collapsible: true,
      collapsedSize: 0,
    })
  })

  it('gives the chat panel no default of its own, so the two never overflow the row', () => {
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    nav.pathname = '/app/projects/p1/chat'
    render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(declaredChat.current).not.toBeNull()
    expect(declaredChat.current).not.toHaveProperty('defaultSize')
  })

  it('does not feed the dragged width back into `defaultSize`', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    const { rerender } = render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )
    expect(declared.current).toMatchObject({ defaultSize: 320 })

    useFilePreviewStore.getState().setPeekWidth(500)
    rerender(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(declared.current).toMatchObject({ defaultSize: 320 })
  })

  it('commits the width once the gesture is over, not once per frame', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(declared.current?.onResize).toBeUndefined()

    panel.sizeInPixels = 540
    group.onLayoutChanged?.({}, { isUserInteraction: true })

    expect(useFilePreviewStore.getState().peekWidth).toBe(540)
    expect(window.localStorage.getItem('filePeek.width')).toBe('540')
  })

  it('ignores layout changes it caused itself', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    panel.sizeInPixels = 540
    group.onLayoutChanged?.({}, { isUserInteraction: false })

    expect(useFilePreviewStore.getState().peekWidth).toBe(320)
    expect(window.localStorage.getItem('filePeek.width')).toBeNull()
  })

  it('treats a seam dragged shut as dismissing the peek', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    panel.sizeInPixels = 0
    group.onLayoutChanged?.({}, { isUserInteraction: true })

    const state = useFilePreviewStore.getState()
    expect(state.hidden).toBe(true)
    expect(state.file?.id).toBe('doc-1')
    expect(state.peekWidth).toBe(320)
  })

  it('opens at the width the reader left it at in an earlier session', () => {
    window.localStorage.setItem('filePeek.width', '620')
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(panel.calls).toContain('resize:620')
    expect(useFilePreviewStore.getState().peekWidth).toBe(620)
  })

  it('names the seam, which the panel library makes a tab stop', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    const { getByRole } = render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(getByRole('separator')).toHaveAttribute('aria-label', 'Resize file preview')
  })

  it('puts the pane back at its default width on a double-click', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().setPeekWidth(520)
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    const { getByRole } = render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )
    panel.calls = []

    fireEvent.doubleClick(getByRole('separator'))

    expect(panel.calls).toEqual(['expand', 'resize:320'])
    expect(useFilePreviewStore.getState().peekWidth).toBe(320)
    expect(separator.current?.disableDoubleClick).toBe(true)
  })

  it('collapses again when the peek is dismissed, so chat reclaims the row', () => {
    nav.pathname = '/app/projects/p1/chat'
    useFilePreviewStore.getState().open(FILE, 'peek', { projectId: 'p1' })
    const { rerender } = render(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )
    expect(panel.calls).toEqual(['expand', 'resize:320'])

    panel.calls = []
    useFilePreviewStore.getState().hide()
    rerender(
      <FilePreviewBridge>
        <div>chat transcript</div>
      </FilePreviewBridge>,
    )

    expect(panel.calls).toEqual(['collapse'])
  })
})
