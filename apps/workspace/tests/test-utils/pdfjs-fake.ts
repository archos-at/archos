import { screen, waitFor } from '@testing-library/react'

export interface FakeTextItem {
  str: string
  width: number
  height: number
  transform: number[]
}

export interface FakePdfState {
  fail: boolean
  pages: Array<{ items: FakeTextItem[] }>
  destroyed: number
  password?: string
}

export const FAKE_PAGE_WIDTH = 600
export const FAKE_PAGE_HEIGHT = 800

export const FAKE_FRAME_WIDTH = FAKE_PAGE_WIDTH + 24

export const fakeTextRun = (str: string, baseline: number, width: number): FakeTextItem => ({
  str,
  width,
  height: 12,
  transform: [12, 0, 0, 12, 72, baseline],
})

export const fakePdfjsRuntime = (state: FakePdfState) => ({
  documentParameters: (url: string) => ({ url }),
  renderTextLayer: async (page: { textItems?: FakeTextItem[] }, container: HTMLElement) => {
    for (const item of page.textItems ?? []) {
      const span = document.createElement('span')
      span.textContent = item.str
      container.append(span)
    }
    return { destroy: () => container.replaceChildren() }
  },
  readPageTextItems: async (page: { textItems?: FakeTextItem[] }) => page.textItems ?? [],
  loadPdfjs: async () => {
    if (state.fail) throw new Error('worker unavailable')
    return {
      getDocument: (parameters: { password?: string } = {}) => ({
        promise: (state.password && parameters.password !== state.password
          ? Promise.reject(
              Object.assign(new Error('No password given'), {
                name: 'PasswordException',
                code: parameters.password ? 2 : 1,
              }),
            )
          : Promise.resolve({
          numPages: state.pages.length,
          getPage: (number: number) =>
            Promise.resolve({
              getViewport: ({ scale }: { scale: number }) => ({
                width: FAKE_PAGE_WIDTH * scale,
                height: FAKE_PAGE_HEIGHT * scale,
                scale,
                transform: [scale, 0, 0, -scale, 0, FAKE_PAGE_HEIGHT * scale],
              }),
              render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
              cleanup: () => {},
              textItems: state.pages[number - 1]?.items ?? [],
            }),
          })),
        destroy: () => {
          state.destroyed += 1
          return Promise.resolve()
        },
      }),
    }
  },
})

export async function selectRenderedText(text: string): Promise<HTMLElement> {
  const layer = await waitFor(() => {
    const found = screen.getAllByTestId('pdf-text-layer').find((node) => node.textContent?.includes(text))
    if (!found) throw new Error(`no text layer holds ${JSON.stringify(text)} yet`)
    return found
  })
  const range = document.createRange()
  range.selectNodeContents(layer)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return layer
}
