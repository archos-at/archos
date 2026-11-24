import { expect, vi } from 'vitest'
import { screen, waitFor } from '@/test-utils'
import type { UserEvent } from '@testing-library/user-event'

export const SAVE_FOLDERS = [
  { id: 'f-plan', name: 'Planung', parentId: null, path: 'Planung', access: 'write' },
  { id: 'f-prot', name: 'Protokolle', parentId: 'f-plan', path: 'Planung/Protokolle', access: 'write' },
  { id: 'f-arch', name: 'Archiv', parentId: null, path: 'Archiv', access: 'read' },
]

const isFolderList = (url: unknown, init?: RequestInit): boolean =>
  String(url).endsWith('/folders') && (init?.method ?? 'GET') === 'GET'

type FetchImpl = (url: string, init?: RequestInit) => Promise<unknown>

export function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      isFolderList(url, init)
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: SAVE_FOLDERS, rootAccess: 'write' }) })
        : impl(url, init),
    ),
  )
}

export function filingCalls(): RequestInit[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes('/draft/file'))
    .map(([, init]) => init as RequestInit)
}

export function filingBody(index = 0): Record<string, unknown> {
  return JSON.parse(filingCalls()[index].body as string) as Record<string, unknown>
}

export async function openSaveDialog(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'File into the project' }))
  await screen.findByTestId('save-to-project')
  await waitFor(() => expect(screen.getByTestId('save-to-project-submit')).not.toHaveAttribute('aria-disabled'))
}

export async function fileThroughDialog(user: UserEvent): Promise<void> {
  await openSaveDialog(user)
  await user.click(screen.getByTestId('save-to-project-submit'))
}
