/**
 * The shared rename dialog of a memory shelf (ADR-0180): the typed name is
 * normalized, the merge targets are the ones the caller passed (never the topic
 * itself), and the dialog closes only when the shelf took the change.
 */
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test-utils'
import { TopicRenameDialog } from './topic-rename-dialog'

function renderDialog(overrides: Partial<Parameters<typeof TopicRenameDialog>[0]> = {}) {
  const props = {
    open: true,
    topic: 'Brandschutz',
    topics: ['Brandschutz', 'Stellplätze', 'Bauherr'],
    onOpenChange: vi.fn(),
    onRename: vi.fn(async () => true),
    ...overrides,
  }
  render(<TopicRenameDialog {...props} />)
  return props
}

describe('TopicRenameDialog', () => {
  test('starts from the topic name, and Save is off until the name changes', () => {
    renderDialog()

    expect(screen.getByLabelText('Topic name')).toHaveValue('Brandschutz')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('offers the merge targets the caller passed, never the topic itself', async () => {
    renderDialog({ topics: ['Brandschutz', 'Stellplätze'] })

    await userEvent.click(screen.getByLabelText('Topic name'))

    const list = screen.getByRole('listbox')
    expect(screen.getByRole('option', { name: 'Stellplätze' })).toBeInTheDocument()
    expect(list).not.toHaveTextContent('Brandschutz')
  })

  test('a typed name filters the merge targets', async () => {
    renderDialog({ topics: ['Brandschutz', 'Stellplätze', 'Bauherr'] })

    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, 'stell')

    expect(screen.getByRole('option', { name: 'Stellplätze' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Bauherr' })).not.toBeInTheDocument()
  })

  test('saves the normalized name and closes when the shelf took it', async () => {
    const props = renderDialog()

    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, '  Brandschutz  Konzept ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(props.onRename).toHaveBeenCalledWith('Brandschutz Konzept'))
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
  })

  test('Enter with no merge target active saves what was typed', async () => {
    const props = renderDialog()

    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Feuerschutz{Enter}')

    await waitFor(() => expect(props.onRename).toHaveBeenCalledWith('Feuerschutz'))
  })

  test('a refused rename keeps the dialog open', async () => {
    const props = renderDialog({ onRename: vi.fn(async () => false) })

    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Feuerschutz')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(props.onRename).toHaveBeenCalledTimes(1))
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('a name over the bound says so and cannot be saved', async () => {
    const props = renderDialog()

    const input = screen.getByLabelText('Topic name')
    await userEvent.clear(input)
    await userEvent.type(input, 'x'.repeat(41))

    expect(screen.getByText('At most 40 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(props.onRename).not.toHaveBeenCalled()
  })

  test('Cancel closes without a change', async () => {
    const props = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onRename).not.toHaveBeenCalled()
  })
})
