import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { CreateProjectDialog } from './create-project-dialog'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects',
}))

vi.mock('./create-project-form', () => ({
  CreateProjectForm: ({ onCancel }: { onCancel?: () => void }) => (
    <div data-testid="create-project-form">
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}))

describe('CreateProjectDialog', () => {
  beforeEach(() => {
    replace.mockClear()
  })

  test('auto-opens when defaultOpen and strips ?new=1 on close', async () => {
    render(<CreateProjectDialog defaultOpen />)

    expect(await screen.findByTestId('create-project-form')).toBeDefined()

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/projects', { scroll: false }))
  })

  test('does not rewrite the URL when it was not auto-opened', async () => {
    render(<CreateProjectDialog />)

    await userEvent.click(screen.getByRole('button', { name: /New project/i }))
    expect(await screen.findByTestId('create-project-form')).toBeDefined()
    await userEvent.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByTestId('create-project-form')).toBeNull(),
    )
    expect(replace).not.toHaveBeenCalled()
  })

  test('the form\'s Cancel closes the dialog', async () => {
    render(<CreateProjectDialog />)

    await userEvent.click(screen.getByRole('button', { name: /New project/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByTestId('create-project-form')).toBeNull())
  })

  test('on a touch pointer the dialog takes the focus itself, so no keyboard opens over the form', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    try {
      render(<CreateProjectDialog />)
      await userEvent.click(screen.getByRole('button', { name: /New project/i }))

      const dialog = await screen.findByRole('dialog')
      await waitFor(() => expect(dialog).toHaveFocus())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('a mouse keeps the focus on the first field', async () => {
    render(<CreateProjectDialog />)
    await userEvent.click(screen.getByRole('button', { name: /New project/i }))

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
  })
})
