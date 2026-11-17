'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { QuoteStamp } from '@/lib/conversations/message-quote-stamps'
import type { ProjectFactResolver } from '@/lib/project-profile/answer-bindings'

export interface RowActionProps {
  subject: string
  detail: string
}

export type RowActionRenderer = (props: RowActionProps) => ReactNode

export interface ExcerptSourceProps {
  number: number
  href: string | null
  stamp?: QuoteStamp | null
}

export type ExcerptSourceRenderer = (props: ExcerptSourceProps) => ReactNode

const RowActionContext = createContext<RowActionRenderer | null>(null)
const ExcerptSourceContext = createContext<ExcerptSourceRenderer | null>(null)

export const MarkdownRowActionProvider = ({ render, children }: { render: RowActionRenderer; children: ReactNode }) => (
  <RowActionContext.Provider value={render}>{children}</RowActionContext.Provider>
)

export const ExcerptSourceProvider = ({ render, children }: { render: ExcerptSourceRenderer; children: ReactNode }) => (
  <ExcerptSourceContext.Provider value={render}>{children}</ExcerptSourceContext.Provider>
)

export const useRowActionRenderer = (): RowActionRenderer | null => useContext(RowActionContext)

export const useExcerptSourceRenderer = (): ExcerptSourceRenderer | null => useContext(ExcerptSourceContext)

export interface SearchedSource {
  title: string
  detail?: string
}

export interface AnswerData {
  project?: ProjectFactResolver
  prefill?: (text: string) => void
  searched?: readonly SearchedSource[]
  quoteStamps?: readonly QuoteStamp[]
  notRegulated?: boolean
}

const NO_DATA: AnswerData = {}
const AnswerDataContext = createContext<AnswerData>(NO_DATA)

export const AnswerDataProvider = ({ value, children }: { value: AnswerData; children: ReactNode }) => (
  <AnswerDataContext.Provider value={value}>{children}</AnswerDataContext.Provider>
)

export const useAnswerData = (): AnswerData => useContext(AnswerDataContext)
