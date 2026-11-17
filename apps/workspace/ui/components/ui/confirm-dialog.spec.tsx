import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './confirm-dialog'

const CONFIRM = 'Zugriff entziehen'

function renderDialog(onConfirm: () => void | Promise<void>) {
  const onOpenChange = vi.fn()

  const Harness = () => {
    const [open, setOpen] = useState(true)
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          setOpen(next)
        }}
        title="Zugriff entziehen?"
        description="Markus verliert den Zugriff auf diesen Thread."
        confirmLabel={CONFIRM}
        cancelLabel="Abbrechen"
        onConfirm={onConfirm}
      />
    )
  }

  render(<Harness />)
  return {
    onOpenChange,
    confirmButton: () => screen.getByRole('button', { name: CONFIRM }),
  }
}

describe('ConfirmDialog', () => {
  it('closes when the action lands', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const { onOpenChange, confirmButton } = renderDialog(onConfirm)

    await user.click(confirmButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('stays open when the action is refused', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('sharing mutation refused'))
    const { onOpenChange, confirmButton } = renderDialog(onConfirm)

    await user.click(confirmButton())

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await waitFor(() => expect(confirmButton()).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeEnabled()
  })

  it('does not let the refusal escape as an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', record)
    try {
      const user = userEvent.setup()
      const { confirmButton } = renderDialog(
        vi.fn().mockRejectedValue(new Error('sharing mutation refused'))
      )

      await user.click(confirmButton())
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', record)
    }
  })

  it('refuses to close while the action is in flight', async () => {
    const user = userEvent.setup()
    let settle: () => void = () => {}
    const { onOpenChange, confirmButton } = renderDialog(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )

    await user.click(confirmButton())
    await waitFor(() => expect(confirmButton()).toHaveAttribute('aria-disabled', 'true'))

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      settle()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
