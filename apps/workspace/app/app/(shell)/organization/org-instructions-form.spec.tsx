import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))

import { ORG_INSTRUCTIONS_MAX_CHARS } from '@/lib/org-instructions/constants'
import { OrgInstructionsForm } from './org-instructions-form'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const box = (): HTMLTextAreaElement => screen.getByLabelText(/standing instructions/i)
const counter = (): HTMLElement => screen.getByTestId('org-instructions-counter')
const saveButton = (): HTMLElement => screen.getByRole('button', { name: /save instructions/i })
const clearButton = (): HTMLElement => screen.getByRole('button', { name: /^clear$/i })

const body = (): Record<string, unknown> =>
  JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>

describe('the instruction editor', () => {
  test('shows what the organization already told Piloti', () => {
    render(<OrgInstructionsForm initialInstructions="Assume Vienna." />)
    expect(box()).toHaveValue('Assume Vienna.')
    expect(saveButton()).toBeDisabled()
  })

  test('counts live, against the cap the server enforces', async () => {
    const user = userEvent.setup()
    render(<OrgInstructionsForm initialInstructions={null} />)

    expect(counter()).toHaveTextContent(`0 of ${ORG_INSTRUCTIONS_MAX_CHARS} characters`)
    await user.type(box(), 'Kurz.')
    expect(counter()).toHaveTextContent(`5 of ${ORG_INSTRUCTIONS_MAX_CHARS} characters`)
  })

  test('over the cap it refuses to save, and says by how much', async () => {
    render(<OrgInstructionsForm initialInstructions={null} />)

    const tooLong = 'a'.repeat(ORG_INSTRUCTIONS_MAX_CHARS + 12)
    await userEvent.setup().click(box())
    await userEvent.setup().paste(tooLong)

    await waitFor(() => expect(counter()).toHaveTextContent('12 characters over'))
    expect(box()).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton()).toBeDisabled()
    expect(box()).toHaveValue(tooLong)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('saving PUTs the block to the organization endpoint', async () => {
    const user = userEvent.setup()
    render(<OrgInstructionsForm initialInstructions={null} />)

    await user.type(box(), 'Lead with the verdict.')
    await user.click(saveButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/organization/instructions')
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(body()).toEqual({ instructions: 'Lead with the verdict.' })
  })

  test('Clear asks first, and writes nothing until it is confirmed', async () => {
    const user = userEvent.setup()
    render(<OrgInstructionsForm initialInstructions="Assume Vienna." />)

    await user.click(clearButton())
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: /^cancel$/i }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(box()).toHaveValue('Assume Vienna.')
  })

  test('Clear is its own act, and sends the empty block deliberately', async () => {
    const user = userEvent.setup()
    render(<OrgInstructionsForm initialInstructions="Assume Vienna." />)

    await user.click(clearButton())
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^clear$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(body()).toEqual({ instructions: '' })
  })

  test('emptying the box does not by itself clear anything', async () => {
    const user = userEvent.setup()
    render(<OrgInstructionsForm initialInstructions="Assume Vienna." />)

    await user.clear(box())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('states the boundary: preferences, never a rule and never a value', () => {
    render(<OrgInstructionsForm initialInstructions={null} />)
    const hint = screen.getByText(/standing preferences on form, focus and workflow/i)
    expect(hint).toHaveTextContent(/never override/i)
    expect(hint).toHaveTextContent(/never supply a normative value/i)
    expect(hint).toHaveTextContent(/OIB requirement comes from the guideline/i)
  })
})
