import { act } from 'react'
import type { ReactElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { TaskRunView } from '../lib/task-view'
import { TaskCard } from './task-card'

const task: TaskRunView = {
  id: 'task-1',
  kind: 'document',
  title: 'Aktenvermerk Fluchtwege',
  goal: null,
  status: 'succeeded',
  review: 'accepted',
  reviewReason: null,
  filedDocumentId: null,
  conversationId: null,
  runMessageId: null,
  taskId: null,
  trigger: 'delegated',
  requesterUserId: 'user_anna',
  requesterName: 'Anna Berger',
  createdAt: '2026-10-15T11:57:00Z',
  finishedAt: null,
  error: null,
}

const card = (): ReactElement => (
  <I18nProvider initialLocale="de" fixedLocale>
    <TaskCard projectId="p1" task={task} onSelect={() => {}} />
  </I18nProvider>
)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a task card rendered on the server and hydrated a minute later', () => {
  it('hydrates without a mismatch, then says how long ago in words', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:30Z'))
    const container = document.createElement('div')
    container.innerHTML = renderToString(card())
    document.body.append(container)

    vi.setSystemTime(new Date('2026-10-15T12:01:40Z'))
    const recoverable = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, card(), { onRecoverableError: recoverable })
    })
    expect(recoverable).not.toHaveBeenCalled()
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydrat/i)
    expect(container.textContent).toContain('vor 4 Minuten')
    act(() => root?.unmount())
    container.remove()
  })
})
