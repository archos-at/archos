export interface CompareFile {
  id: string
  filename: string
}

export type { CompareRegion } from '@/lib/documents/revision-compare-types'

export type CompareMode = 'side' | 'overlay' | 'swipe'

export const COMPARE_MODES: readonly CompareMode[] = ['side', 'overlay', 'swipe']

export interface PageSize {
  width: number
  height: number
}

export interface RenderHandle {
  promise: Promise<void>
  cancel: () => void
}

export interface PageSource {
  pageCount: number
  pageSize: (page: number) => Promise<PageSize>
  render: (
    page: number,
    canvas: HTMLCanvasElement,
    options: { scale: number; pixelRatio: number; region?: { x: number; y: number; width: number; height: number } },
  ) => RenderHandle
  destroy: () => void
}

export class NotComparableError extends Error {
  constructor(message = 'not comparable visually') {
    super(message)
    this.name = 'NotComparableError'
  }
}

export type SourceLoader = (file: CompareFile) => Promise<PageSource>
