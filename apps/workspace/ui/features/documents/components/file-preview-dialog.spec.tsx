import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { FilePreviewDialog } from './file-preview-dialog'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/projects/proj-1/files',
  useSearchParams: () => new URLSearchParams(),
}))

const FILE = {
  id: 'doc-1',
  filename: 'plan.pdf',
  displayName: null,
  fileSize: 1_048_576,
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

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open plan.pdf
      </button>
      <button type="button">Somewhere else</button>
      <FilePreviewDialog file={open ? FILE : null} onClose={() => setOpen(false)} />
    </>
  )
}

describe('FilePreviewDialog focus handling', () => {
  it('returns focus to the control that opened it when Escape closes it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Open plan.pdf' })
    await user.click(opener)
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('does not arm a control inside the dialog on open', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Open plan.pdf' }))
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => expect(dialog).toHaveFocus())
  })

  it('falls back to Radix when the opener is gone', async () => {
    const user = userEvent.setup()

    function Vanishing() {
      const [open, setOpen] = useState(false)
      const [openerGone, setOpenerGone] = useState(false)
      return (
        <>
          {!openerGone && (
            <button type="button" onClick={() => setOpen(true)}>
              Open plan.pdf
            </button>
          )}
          <FilePreviewDialog
            file={open ? FILE : null}
            onClose={() => {
              setOpenerGone(true)
              setOpen(false)
            }}
          />
        </>
      )
    }

    render(<Vanishing />)
    await user.click(screen.getByRole('button', { name: 'Open plan.pdf' }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement?.isConnected).toBe(true)
  })
})
