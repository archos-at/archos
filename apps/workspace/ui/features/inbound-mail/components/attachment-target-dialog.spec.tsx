/**
 * „Ändern“ is an editor, so it keeps an unsaved edit through a stray press
 * (`design-language.md`, „Getting back out“): Escape asks first, „Weiter
 * bearbeiten“ keeps the edit, the confirmation closes with nothing applied,
 * and an unchanged dialog closes without asking.
 */

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test-utils'
import { part } from '@/app/dev/inbound-mail/fixture-builders'
import type { AttachmentDraft } from '../lib/draft'
import { AttachmentTargetDialog } from './attachment-target-dialog'

const PART = part({ name: 'Bescheid.pdf' })

const DRAFT: AttachmentDraft = {
  partId: PART.id,
  checked: true,
  name: 'Bescheid.pdf',
  folder: null,
  documentType: null,
  revisionOf: null,
  releaseName: false,
  acknowledgeRisk: false,
  suggested: { folder: false, name: false, documentType: false },
}

function Harness({ onApply, onClosed }: { onApply: () => void; onClosed: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <AttachmentTargetDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onClosed()
      }}
      part={PART}
      draft={DRAFT}
      onApply={onApply}
    />
  )
}

function renderDialog() {
  const onApply = vi.fn()
  const onClosed = vi.fn()
  render(<Harness onApply={onApply} onClosed={onClosed} />)
  return { onApply, onClosed }
}

describe('AttachmentTargetDialog › an unsaved edit', () => {
  it('asks before Escape leaves a changed name behind, and keeps editing on „Keep editing“', async () => {
    const { onClosed } = renderDialog()
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Bescheid_MA37.pdf')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText('Leave without your changes?')).toBeInTheDocument()
    expect(onClosed).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() =>
      expect(screen.queryByText('Leave without your changes?')).not.toBeInTheDocument()
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Bescheid_MA37.pdf')
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('closes with nothing applied once the person confirms', async () => {
    const { onApply, onClosed } = renderDialog()
    await userEvent.type(screen.getByLabelText('Name'), 'x')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByTestId('unsaved-edit-confirm'))
    await waitFor(() => expect(onClosed).toHaveBeenCalled())
    expect(onApply).not.toHaveBeenCalled()
  })

  it('closes at once when nothing was changed', async () => {
    const { onClosed } = renderDialog()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onClosed).toHaveBeenCalled())
    expect(screen.queryByText('Leave without your changes?')).not.toBeInTheDocument()
  })
})
