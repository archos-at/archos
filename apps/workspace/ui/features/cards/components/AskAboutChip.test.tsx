import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { I18nProvider } from '@/i18n'
import { AskAboutChip } from './AskAboutChip'
import { DimChecksList } from '../schematics/kit'

const setComposerPrefill = vi.fn()
const chatSendFn = vi.fn()

const mockStoreState = () => ({ setComposerPrefill, chatSendFn })

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: ReturnType<typeof mockStoreState>) => unknown) =>
    selector(mockStoreState())
  useChatStore.getState = () => mockStoreState()
  return { useChatStore }
})

const renderDe = (ui: ReactElement) =>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      {ui}
    </I18nProvider>,
  )

const CHIP = 'Dazu fragen'

describe('AskAboutChip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds a complete question out of the row and prefills it verbatim', async () => {
    const user = userEvent.setup()
    renderDe(
      <AskAboutChip
        subject="Handlauf beidseitig"
        missing="Dieser Export enthält kein IfcRailing — Handläufe im CAD als IfcRailing modellieren."
      />,
    )

    await user.click(screen.getByRole('button', { name: /Handlauf beidseitig/ }))

    expect(setComposerPrefill).toHaveBeenCalledWith(
      'Bei „Handlauf beidseitig“ fehlt eine Angabe: Dieser Export enthält kein IfcRailing — ' +
        'Handläufe im CAD als IfcRailing modellieren. Wie kann ich das nachreichen, und was gilt bis dahin?',
    )
  })

  it('asks what is needed when the row names no remedy', async () => {
    const user = userEvent.setup()
    renderDe(<AskAboutChip subject="Brandmeldeanlage Kategorie 1" />)

    await user.click(screen.getByRole('button', { name: /Brandmeldeanlage/ }))

    expect(setComposerPrefill).toHaveBeenCalledWith(
      'Bei „Brandmeldeanlage Kategorie 1“ fehlt eine Angabe. ' +
        'Welche Angabe wird dafür benötigt, und woher bekomme ich sie?',
    )
  })

  it('renders nothing rather than a question with a hole in it', () => {
    const { container } = renderDe(<AskAboutChip subject="  " missing="egal" />)
    expect(container.querySelector('button')).toBeNull()

    const { container: second } = renderDe(<AskAboutChip subject={null} />)
    expect(second.querySelector('button')).toBeNull()
  })

  it('sends nothing and fetches nothing on click', async () => {
    const user = userEvent.setup()
    renderDe(<AskAboutChip subject="Handlauf beidseitig" missing="kein IfcRailing im Export" />)

    await user.click(screen.getByRole('button', { name: /Handlauf beidseitig/ }))

    expect(chatSendFn).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is operable from the keyboard alone', async () => {
    const user = userEvent.setup()
    renderDe(<AskAboutChip subject="Handlauf beidseitig" missing="kein IfcRailing im Export" />)

    await user.tab()
    expect(screen.getByRole('button', { name: /Handlauf beidseitig/ })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(setComposerPrefill).toHaveBeenCalledTimes(1)
  })

  it('carries the whole question in the tooltip', () => {
    renderDe(<AskAboutChip subject="Handlauf beidseitig" missing="kein IfcRailing im Export" />)

    expect(screen.getByRole('button', { name: /Handlauf beidseitig/ })).toHaveAttribute(
      'title',
      'Bei „Handlauf beidseitig“ fehlt eine Angabe: kein IfcRailing im Export. ' +
        'Wie kann ich das nachreichen, und was gilt bis dahin?',
    )
  })
})

describe('a schematic legend offers the question next to the remedy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefills the CAD remedy the row already names', async () => {
    const user = userEvent.setup()
    renderDe(
      <DimChecksList
        checks={[
          { label: 'Neigung', value: 7.2, required: 6, unit: '%', comparator: '<=', status: 'fail' },
          {
            label: 'Handlauf beidseitig',
            value: null,
            unit: 'cm',
            status: 'needs_input',
            missing:
              'Dieser Export enthält kein IfcRailing — Handläufe im CAD als IfcRailing modellieren.',
          },
        ]}
      />,
    )

    expect(screen.getAllByText(CHIP)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /Handlauf beidseitig/ }))

    expect(setComposerPrefill).toHaveBeenCalledWith(
      'Bei „Handlauf beidseitig“ fehlt eine Angabe: Dieser Export enthält kein IfcRailing — ' +
        'Handläufe im CAD als IfcRailing modellieren. Wie kann ich das nachreichen, und was gilt bis dahin?',
    )
    expect(chatSendFn).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  describe('trailing-mark stripping is linear in the length of the label', () => {
    it('does not stall on a label that is all sentence marks', () => {
      const started = performance.now()

      renderDe(<AskAboutChip subject={`Neigung${':'.repeat(32_000)}-`} missing="Wert fehlt" />)
      const elapsed = performance.now() - started

      expect(elapsed).toBeLessThan(400)
    })

    it('still drops the trailing mark so the template punctuation stands alone', async () => {
      const user = userEvent.setup()
      renderDe(<AskAboutChip subject="Handlauf beidseitig." missing="Im CAD modellieren." />)

      await user.click(screen.getByRole('button'))

      const [sent] = setComposerPrefill.mock.calls.at(-1) as [string]
      expect(sent).not.toContain('..')
      expect(sent).toContain('„Handlauf beidseitig“')
    })
  })
})
