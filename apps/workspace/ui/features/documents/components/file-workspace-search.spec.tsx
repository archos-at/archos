import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import type { SearchWorkspaceProps } from '@/features/search'
import type { FileShelf } from '../lib/file-shelf'
import { FileWorkspace } from './file-workspace'

const nav = vi.hoisted(() => ({ search: 'mode=search&folder=f-1', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/shelf',
  useSearchParams: () => new URLSearchParams(nav.search),
}))

vi.mock('@/features/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/search')>()),
  SearchWorkspace: ({ surface, currentUserId }: SearchWorkspaceProps) => (
    <div data-testid="search-workspace" data-surface={JSON.stringify(surface)} data-user={currentUserId ?? ''} />
  ),
}))

beforeEach(() => {
  nav.search = 'mode=search&folder=f-1'
  nav.push.mockClear()
})

const shelfOf = (source: FileShelf['source']): FileShelf =>
  ({ source, projectId: source === 'project' ? 'p-1' : null, currentUserId: 'u-1' }) as FileShelf

const head = (controls: React.ReactNode) => <div data-testid="head">{controls}</div>

describe('the search mode of a shelf (FileWorkspace)', () => {
  const cases = [
    ['project', { kind: 'project', projectId: 'p-1', folderId: 'f-1' }, 'Back to documents'],
    ['office', { kind: 'office_shelf', folderId: 'f-1' }, 'Back to the filing'],
    ['personal', { kind: 'personal', folderId: 'f-1' }, 'Back to the filing'],
  ] as const
  for (const [source, surface, back] of cases) {
    it(`opens for the ${source} shelf: its head keeps its place with the way back in its tools, the search under it`, async () => {
      render(<FileWorkspace shelf={shelfOf(source)} renderHeader={head} />)
      const search = screen.getByTestId('search-workspace')
      expect(JSON.parse(search.dataset.surface!)).toEqual(surface)
      expect(search).toHaveAttribute('data-user', 'u-1')
      const close = within(screen.getByTestId('head')).getByTestId('shelf-search-close')
      expect(close).toHaveTextContent(back)
      await userEvent.click(close)
      expect(nav.push).toHaveBeenCalledWith('/app/shelf?folder=f-1', { scroll: false })
    })
  }
})
