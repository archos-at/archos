import { act } from 'react'
import type { ReactElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SEARCH_FIXTURE_RESPONSE } from '@/app/dev/_fixtures/search'
import { MOBILE_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import { I18nProvider } from '@/i18n'
import { EMPTY_SEARCH_STATE } from '../lib/search-url'
import { sectionView } from '../lib/sections'
import { SearchWorkspaceView } from './search-workspace-view'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/search',
  useSearchParams: () => new URLSearchParams(''),
}))

function viewport(mobile: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === MOBILE_LAYOUT_QUERY ? mobile : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  )
}

const register = (): ReactElement => (
  <I18nProvider initialLocale="de" fixedLocale>
    <SearchWorkspaceView
      surface={{ kind: 'office' }}
      state={{ ...EMPTY_SEARCH_STATE, view: 'register' }}
      onStateChange={() => {}}
      fieldValue=""
      onFieldChange={() => {}}
      response={SEARCH_FIXTURE_RESPONSE}
      sections={{ document: sectionView(SEARCH_FIXTURE_RESPONSE.sections.document!) }}
      loading={false}
      failed={false}
      onRetry={() => {}}
      onLoadMore={() => {}}
    />
  </I18nProvider>
)

const serverMarkup = (): HTMLDivElement => {
  const container = document.createElement('div')
  container.innerHTML = renderToString(register())
  return container
}

afterEach(() => vi.restoreAllMocks())

describe('the search register before the bundle boots', () => {
  it('sends the phone list under md:hidden and the desktop table under max-md:hidden, so a phone paints its list first', () => {
    const html = serverMarkup()
    expect(html.querySelector('.md\\:hidden ul[role="listbox"]')).not.toBeNull()
    expect(html.querySelector('.max-md\\:hidden table')).not.toBeNull()
    expect(html.querySelector('.md\\:hidden [data-testid="search-rail-toggle"]')).not.toBeNull()
    expect(html.querySelector('.md\\:hidden [data-testid="search-register-sort"]')).not.toBeNull()
  })

  it('names no element twice while both trees are in the markup', () => {
    const ids = [...serverMarkup().querySelectorAll('[id]')].map((element) => element.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
    const testIds = [...serverMarkup().querySelectorAll('[data-testid^="search-register"]')].map((element) => element.getAttribute('data-testid'))
    expect(testIds.filter((id, index) => testIds.indexOf(id) !== index)).toEqual([])
  })

  it('hydrates on a phone without a mismatch and keeps only the list, which the field controls', async () => {
    const container = serverMarkup()
    document.body.append(container)
    viewport(true)
    const recoverable = vi.fn()
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, register(), { onRecoverableError: recoverable })
    })
    expect(recoverable).not.toHaveBeenCalled()
    const list = container.querySelector('[data-testid="search-register"]')
    expect(list?.tagName).toBe('UL')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('[data-testid="search-rail"]')).toBeNull()
    expect(container.querySelector('[role="combobox"]')?.getAttribute('aria-controls')).toBe(list?.id)
    act(() => root?.unmount())
    container.remove()
  })
})
