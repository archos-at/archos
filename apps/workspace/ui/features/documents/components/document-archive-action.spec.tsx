import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import { DocumentArchiveAction } from './document-archive-action'

describe('DocumentArchiveAction', () => {
  it('does not archive on the first click', async () => {
    const onArchive = vi.fn()
    render(<DocumentArchiveAction filename="Aktenvermerk.pdf" onArchive={onArchive} />)

    await userEvent.click(screen.getByTestId('document-lifecycle-archive'))

    expect(onArchive).not.toHaveBeenCalled()
    expect(await screen.findByTestId('document-archive-consequences')).toBeInTheDocument()
  })

  it('states the four consequences, including the two that surprise people', async () => {
    render(<DocumentArchiveAction filename="Aktenvermerk.pdf" onArchive={() => undefined} />)
    await userEvent.click(screen.getByTestId('document-lifecycle-archive'))

    const list = await screen.findByTestId('document-archive-consequences')
    expect(list.children).toHaveLength(4)
    expect(list).toHaveTextContent('Also show retired')
    expect(list).toHaveTextContent('stops citing it')
    expect(list).toHaveTextContent('not a delete')
    expect(list).toHaveTextContent('cannot be undone')
  })

  it('names the file in the question', async () => {
    render(<DocumentArchiveAction filename="Aktenvermerk.pdf" onArchive={() => undefined} />)
    await userEvent.click(screen.getByTestId('document-lifecycle-archive'))

    expect(await screen.findByRole('dialog')).toHaveTextContent('Aktenvermerk.pdf')
  })

  it('archives once the reader confirms', async () => {
    const onArchive = vi.fn()
    render(<DocumentArchiveAction filename="Aktenvermerk.pdf" onArchive={onArchive} />)

    await userEvent.click(screen.getByTestId('document-lifecycle-archive'))
    await userEvent.click(await screen.findByTestId('document-archive-confirm'))

    expect(onArchive).toHaveBeenCalledTimes(1)
  })
})
