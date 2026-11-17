import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { FileFilterMenu } from './file-filter-menu'
import { NO_FILE_FILTERS, type FileFilters } from '../lib/file-filters'
import { DEFAULT_FILE_SORT, type FileSort } from '../lib/file-sort'
import { PRODUCT_NAME } from '@/lib/brand'

const renderMenu = (overrides: Partial<Parameters<typeof FileFilterMenu>[0]> = {}) => {
  const onFiltersChange = vi.fn<(next: FileFilters) => void>()
  const onSortChange = vi.fn<(next: FileSort) => void>()
  render(
    <FileFilterMenu
      canCollaborate
      filters={NO_FILE_FILTERS}
      onFiltersChange={onFiltersChange}
      sort={DEFAULT_FILE_SORT}
      onSortChange={onSortChange}
      {...overrides}
    />
  )
  return { onFiltersChange, onSortChange }
}

const open = () => userEvent.click(screen.getByTestId('file-filter-menu-trigger'))

describe('the retired filter', () => {
  test('offers a way back to a file somebody archived', async () => {
    const { onFiltersChange } = renderMenu()
    await open()
    await userEvent.click(screen.getByLabelText(/retired/i))
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
    )
  })
})

describe('the older revisions filter', () => {
  test('offers the older Fassungen beside their current one, and says it widens', async () => {
    const { onFiltersChange } = renderMenu()
    await open()
    await userEvent.click(screen.getByLabelText('Older revisions'))
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ showOlderRevisions: true }),
    )
  })

  test('sits with the retired filter, the other toggle that widens, under one heading', async () => {
    renderMenu()
    await open()
    const alsoShow = screen.getByRole('group', { name: 'Also show' })
    expect(within(alsoShow).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(alsoShow).getByLabelText('Retired')).toBeInTheDocument()
    expect(within(alsoShow).getByLabelText('Older revisions')).toBeInTheDocument()
    const origin = screen.getByRole('group', { name: 'Origin and approval' })
    expect(within(origin).getByLabelText(`By ${PRODUCT_NAME}`)).toBeInTheDocument()
    expect(within(origin).getByLabelText('Awaiting approval')).toBeInTheDocument()
  })

  test('counts the older revisions once on the trigger when they are shown', () => {
    renderMenu({ filters: { ...NO_FILE_FILTERS, showOlderRevisions: true } })
    expect(screen.getByTestId('file-filter-count')).toHaveTextContent('1')
  })
})

describe('FileFilterMenu', () => {
  test('shows no count while nothing is filtered', () => {
    renderMenu()
    expect(screen.queryByTestId('file-filter-count')).not.toBeInTheDocument()
  })

  test('puts the count in the accessible name, not only in the pill', async () => {
    renderMenu({ filters: { ...NO_FILE_FILTERS, assignment: 'mine', kinds: ['photo'] } })
    expect(screen.getByTestId('file-filter-count')).toHaveTextContent('2')
    expect(screen.getByTestId('file-filter-menu-trigger')).toHaveAccessibleName(/2/)
  })

  test('does not count assignment when the section is not offered', () => {
    renderMenu({ canCollaborate: false, filters: { ...NO_FILE_FILTERS, assignment: 'mine' } })
    expect(screen.queryByTestId('file-filter-count')).not.toBeInTheDocument()
  })

  test('hides the assignment section when collaboration is off', async () => {
    renderMenu({ canCollaborate: false })
    await open()
    expect(screen.queryByRole('group', { name: 'Responsible' })).not.toBeInTheDocument()
    expect(await screen.findByLabelText(`By ${PRODUCT_NAME}`)).toBeInTheDocument()
  })

  test('toggles a kind without disturbing the other dimensions', async () => {
    const { onFiltersChange } = renderMenu({
      filters: { ...NO_FILE_FILTERS, assignment: 'mine', statuses: ['failed'] },
    })
    await open()
    await userEvent.click(await screen.findByLabelText('3D model (IFC)'))
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...NO_FILE_FILTERS,
      assignment: 'mine',
      statuses: ['failed'],
      kinds: ['model'],
    })
  })

  test('a new sort column takes its own default direction', async () => {
    const { onSortChange } = renderMenu({ sort: { key: 'added', direction: 'desc' } })
    await open()
    await userEvent.click(await screen.findByRole('radio', { name: 'Name' }))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'asc' })
  })

  test('flips the direction without changing the column', async () => {
    const { onSortChange } = renderMenu({ sort: { key: 'size', direction: 'desc' } })
    await open()
    await userEvent.click(await screen.findByTestId('file-filter-direction'))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'size', direction: 'asc' })
  })

  test('offers no ordering while a semantic search is active', async () => {
    renderMenu({ sortDisabled: true })
    await open()
    expect(await screen.findByLabelText('Photo')).toBeInTheDocument()
    expect(screen.queryByTestId('file-filter-direction')).not.toBeInTheDocument()
  })

  test('reset is offered but inert while nothing is filtered', async () => {
    const { onFiltersChange } = renderMenu()
    await open()
    expect(await screen.findByTestId('file-filter-reset')).toBeDisabled()
    expect(onFiltersChange).not.toHaveBeenCalled()
  })

  test('reset clears every dimension at once, the server-side one included', async () => {
    const { onFiltersChange } = renderMenu({
      filters: {
        ...NO_FILE_FILTERS,
        assignment: 'unassigned',
        agentAuthoredOnly: true,
        kinds: ['photo'],
        statuses: ['ready'],
      },
    })
    await open()
    await userEvent.click(await screen.findByTestId('file-filter-reset'))
    expect(onFiltersChange).toHaveBeenCalledWith(NO_FILE_FILTERS)
  })
})
