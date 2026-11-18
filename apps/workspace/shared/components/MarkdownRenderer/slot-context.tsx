'use client'

import { createContext, useContext, type ReactNode } from 'react'

export const MARKDOWN_SLOT_TAG = 'markdown-slot'

export type MarkdownSlotRenderer = (index: number) => ReactNode

const MarkdownSlotContext = createContext<MarkdownSlotRenderer | null>(null)

export const MarkdownSlotProvider = ({
  render,
  children,
}: {
  render: MarkdownSlotRenderer
  children: ReactNode
}) => <MarkdownSlotContext.Provider value={render}>{children}</MarkdownSlotContext.Provider>

export const useMarkdownSlotRenderer = (): MarkdownSlotRenderer | null =>
  useContext(MarkdownSlotContext)
