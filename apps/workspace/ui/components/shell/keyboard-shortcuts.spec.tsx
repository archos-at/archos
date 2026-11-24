import { render, screen, waitFor, within } from '@/test-utils'
import { act, fireEvent } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { KeyboardShortcuts } from './keyboard-shortcuts'
import { projectIdFromPathname } from './command-palette'
import { SHORTCUTS_PREFERENCE_KEY } from '@/hooks/use-shortcuts-preference'
import { ShellSearchButton } from './shell-search-button'
import { useShellOverlays } from './shell-overlays'

const push = vi.fn()
let pathname = '/app/projects'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}))

const signOut = vi.fn()
vi.mock('@/adapters/auth/use-auth', () => ({
  useAuth: () => ({ signOut }),
}))

const projects = [
  { id: 'p1', name: 'Alpine Tower' },
  { id: 'p2', name: 'Donau Loft' },
]

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const pressCmdK = () => fireEvent.keyDown(window, { key: 'k', metaKey: true })

describe('KeyboardShortcuts', () => {
  beforeEach(() => {
    push.mockClear()
    window.localStorage.removeItem(SHORTCUTS_PREFERENCE_KEY)
    useShellOverlays.setState({ paletteOpen: false })
    pathname = '/app/projects'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => projects }),
    )
  })

  test('⌘K opens the search with the general entries, and lists no project and no section', async () => {
    pathname = '/app/projects/p1/chat'
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    pressCmdK()

    expect(await screen.findByPlaceholderText('Find files, chats and projects …')).toBeInTheDocument()
    for (const entry of ['General', 'New project', 'Organization', 'Profile', 'Toggle theme', 'Sign out']) {
      expect(screen.getByText(entry)).toBeInTheDocument()
    }
    for (const gone of ['Current project', 'Alpine Tower', 'Setup']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })

  test('org and sign-out entries follow their capability props', async () => {
    render(<KeyboardShortcuts authRequired={false} canViewOrganization={false} />)

    pressCmdK()

    expect(await screen.findByText('New project')).toBeInTheDocument()
    expect(screen.queryByText('Organization')).toBeNull()
    expect(screen.queryByText('Sign out')).toBeNull()
  })

  test('? opens the shortcuts cheatsheet', async () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    expect(await screen.findByText('Keyboard shortcuts')).toBeInTheDocument()
    for (const group of ['General', 'Jump to', 'Chat']) {
      expect(screen.getByRole('heading', { level: 3, name: group })).toBeInTheDocument()
    }
    expect(screen.getByText('Open the search')).toBeInTheDocument()
    expect(screen.getByText('Close a dialog or menu')).toBeInTheDocument()
    expect(screen.getByText('Send message')).toBeInTheDocument()
    expect(screen.getByText('New line')).toBeInTheDocument()
    expect(screen.getByText('Pick a numbered option')).toBeInTheDocument()
  })

  test('the cheatsheet documents every jump the handler actually binds', async () => {
    render(<KeyboardShortcuts authRequired canViewOrganization canAccessOfficeShelf />)

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    await screen.findByText('Keyboard shortcuts')
    const jumps = within(document.querySelector<HTMLElement>('[data-shortcut-group="navigation"]')!)
    for (const label of ['All projects', 'Organization', 'Chat', 'Documents', 'Office library', 'Overview']) {
      expect(jumps.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByText('Skills')).toBeNull()
    expect(screen.queryByText('Knowledge')).toBeNull()
    const filesRow = document.querySelector('[data-shortcut="jump-f"]')
    const caps = Array.from(filesRow?.querySelectorAll('kbd') ?? []).map((cap) => cap.textContent)
    expect(caps).toEqual(['G', 'F'])
    expect(filesRow?.textContent).toContain('then')
  })

  test('a gated-off shortcut group row disappears with its feature', async () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    await screen.findByText('Keyboard shortcuts')
    expect(screen.queryByText('Mention a colleague')).toBeNull()
  })

  test('g then p navigates to the projects list', async () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'p' })

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/projects'))
  })

  test('g then a section key jumps within the project the user is in', async () => {
    pathname = '/app/projects/p1/chat'
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'f' })

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/projects/p1/files'))
  })

  test('a project-scoped jump outside a project does nothing', () => {
    pathname = '/app/profile'
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'f' })

    expect(push).not.toHaveBeenCalled()
  })

  test('cross-project doorways jump from anywhere, and stay gated', async () => {
    pathname = '/app/profile'
    const { unmount } = render(<KeyboardShortcuts authRequired canViewOrganization canAccessOfficeShelf />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/office-shelf'))

    unmount()
    push.mockClear()
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'a' })
    expect(push).not.toHaveBeenCalled()
  })

  test('a lone modifier keypress does not spend the armed leader', async () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    fireEvent.keyDown(window, { key: 'CapsLock' })
    fireEvent.keyDown(window, { key: 'p' })

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/projects'))
  })

  test('Escape cancels a pending leader sequence', () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'p' })

    expect(push).not.toHaveBeenCalled()
  })

  test('an unbound second key disarms the leader instead of navigating', () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'z' })
    expect(push).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'p' })
    expect(push).not.toHaveBeenCalled()
  })

  test('a bare modifier keypress does not spend the armed leader', async () => {
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    fireEvent.keyDown(window, { key: 'p' })

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/projects'))
  })

  test('plain-key shortcuts do not fire while typing in an input', async () => {
    render(
      <>
        <input aria-label="Field" />
        <KeyboardShortcuts authRequired canViewOrganization />
      </>,
    )

    const input = screen.getByLabelText('Field')
    input.focus()
    fireEvent.keyDown(input, { key: '?', shiftKey: true })
    fireEvent.keyDown(input, { key: 'g' })
    fireEvent.keyDown(input, { key: 'p' })

    expect(screen.queryByText('Keyboard shortcuts')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  test('user toggle off: everything is inert — no dialogs, no keydown listeners', () => {
    window.localStorage.setItem(SHORTCUTS_PREFERENCE_KEY, 'false')
    const addListener = vi.spyOn(window, 'addEventListener')

    const { container } = render(<KeyboardShortcuts authRequired canViewOrganization />)

    expect(addListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0)
    expect(container).toBeEmptyDOMElement()

    pressCmdK()
    fireEvent.keyDown(window, { key: '?', shiftKey: true })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'p' })

    expect(screen.queryByPlaceholderText('Find files, chats and projects …')).toBeNull()
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull()
    expect(push).not.toHaveBeenCalled()

    addListener.mockRestore()
  })

  test('the header search button opens the same palette ⌘K does', async () => {
    render(
      <>
        <ShellSearchButton />
        <KeyboardShortcuts authRequired canViewOrganization />
      </>,
    )
    expect(screen.queryByPlaceholderText('Find files, chats and projects …')).toBeNull()

    fireEvent.click(screen.getByTestId('shell-search'))

    expect(await screen.findByPlaceholderText('Find files, chats and projects …')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByPlaceholderText('Find files, chats and projects …')).toBeNull())
    expect(useShellOverlays.getState().paletteOpen).toBe(false)
  })

  test('with shortcuts off the keys are inert, but the search button still opens the palette', async () => {
    window.localStorage.setItem(SHORTCUTS_PREFERENCE_KEY, 'false')
    render(<KeyboardShortcuts authRequired canViewOrganization />)

    pressCmdK()
    expect(screen.queryByPlaceholderText('Find files, chats and projects …')).toBeNull()

    act(() => useShellOverlays.getState().setPaletteOpen(true))
    expect(await screen.findByPlaceholderText('Find files, chats and projects …')).toBeInTheDocument()
  })

  test('keydown listener is removed on unmount', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<KeyboardShortcuts authRequired canViewOrganization />)
    const added = addListener.mock.calls.filter(([type]) => type === 'keydown')
    expect(added).toHaveLength(1)

    unmount()
    const removed = removeListener.mock.calls.filter(([type]) => type === 'keydown')
    expect(removed.map(([, handler]) => handler)).toContain(added[0][1])

    addListener.mockRestore()
    removeListener.mockRestore()
  })
})

describe('projectIdFromPathname', () => {
  test('extracts the id from project routes', () => {
    expect(projectIdFromPathname('/app/projects/p1')).toBe('p1')
    expect(projectIdFromPathname('/app/projects/p1/files')).toBe('p1')
  })

  test('returns null outside a project', () => {
    expect(projectIdFromPathname('/app/projects')).toBeNull()
    expect(projectIdFromPathname('/app/profile')).toBeNull()
    expect(projectIdFromPathname('')).toBeNull()
  })
})
