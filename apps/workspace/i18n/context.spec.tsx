import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider, useLocale } from './index'

const Probe = () => {
  const { locale } = useLocale()
  return <span data-testid="locale">{locale}</span>
}

const stubPreferredLocale = (locale: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/user/preferences')) {
        return new Response(JSON.stringify({ prefs: { locale } }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
  )
}

describe('I18nProvider locale reconciliation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adopts the saved user preference by default', async () => {
    stubPreferredLocale('en')

    render(
      <I18nProvider initialLocale="de">
        <Probe />
      </I18nProvider>
    )

    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('en'))
  })

  it('keeps the pinned locale, and asks for nothing, when fixedLocale is set', async () => {
    stubPreferredLocale('en')

    render(
      <I18nProvider initialLocale="de" fixedLocale>
        <Probe />
      </I18nProvider>
    )

    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('de'))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('an explicit choice outranks an in-flight reconciliation', () => {
  const Switcher = ({ to }: { to: 'de' | 'en' }) => {
    const { locale, setLocale } = useLocale()
    return (
      <>
        <span data-testid="locale">{locale}</span>
        <button onClick={() => setLocale(to)}>switch</button>
      </>
    )
  }

  it('does not overwrite a locale the user picked while the read was pending', async () => {
    let releasePrefs = (): void => {}
    const prefsPending = new Promise<void>((resolve) => {
      releasePrefs = () => resolve()
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/user/preferences')) {
          if (init?.method === 'PATCH') return new Response('{}', { status: 200 })
          await prefsPending
          return new Response(JSON.stringify({ prefs: { locale: 'de' } }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
      })
    )

    const user = userEvent.setup()
    render(
      <I18nProvider initialLocale="en">
        <Switcher to="en" />
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: 'switch' }))
    expect(screen.getByTestId('locale')).toHaveTextContent('en')

    releasePrefs()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('en'))
    expect(document.cookie).not.toContain('locale=de')
  })
})
