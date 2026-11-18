import { createContext, useContext } from 'react'

export interface MarkdownRenderState {
  compact: boolean
  headingIds: ReadonlyMap<number, string>
  streamingLines: readonly string[] | null
}

export const NO_HEADINGS: ReadonlyMap<number, string> = new Map()

export const MarkdownRenderStateContext = createContext<MarkdownRenderState>({
  compact: false,
  headingIds: NO_HEADINGS,
  streamingLines: null,
})

export const useMarkdownRenderState = (): MarkdownRenderState => useContext(MarkdownRenderStateContext)

export interface MarkdownStreamState {
  streaming: boolean
  streamedHere: boolean
}

export const MarkdownStreamStateContext = createContext<MarkdownStreamState>({ streaming: false, streamedHere: false })

export const useMarkdownStreamState = (): MarkdownStreamState => useContext(MarkdownStreamStateContext)
