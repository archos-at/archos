import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MOBILE_LAYOUT_QUERY } from '@/hooks/use-is-mobile'
import { DesktopLayoutOnly, MobileLayoutOnly } from './layout-only'

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

const page = (
  <main>
    <MobileLayoutOnly>
      <ul data-testid="stack" />
    </MobileLayoutOnly>
    <DesktopLayoutOnly>
      <table data-testid="table" />
    </DesktopLayoutOnly>
  </main>
)

afterEach(() => vi.restoreAllMocks())

describe('a layout the stylesheet decides before the first paint', () => {
  it('sends both trees from the server, each hidden by the breakpoint it does not belong to', () => {
    const html = document.createElement('div')
    html.innerHTML = renderToString(page)
    expect(html.querySelector('.contents.md\\:hidden [data-testid="stack"]')).not.toBeNull()
    expect(html.querySelector('.contents.max-md\\:hidden [data-testid="table"]')).not.toBeNull()
  })

  it.each([
    [true, 'stack', 'table'],
    [false, 'table', 'stack'],
  ])('hydrates the server markup without a mismatch on mobile=%s, then drops the hidden tree', async (mobile, kept, dropped) => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(page)
    document.body.append(container)
    viewport(mobile)
    const recoverable = vi.fn()
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, page, { onRecoverableError: recoverable })
    })
    expect(recoverable).not.toHaveBeenCalled()
    expect(container.querySelector(`[data-testid="${kept}"]`)).not.toBeNull()
    expect(container.querySelector(`[data-testid="${dropped}"]`)).toBeNull()
    act(() => root?.unmount())
    container.remove()
  })
})
