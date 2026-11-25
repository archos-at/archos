'use client'

import { createContext, useContext } from 'react'
import type { AnswerFooterEvent, FooterPanel } from '../../lib/answer-footer-machine'

export interface AnswerFooterControls {
  panel: FooterPanel | null
  send: (event: AnswerFooterEvent) => void
  drawerId: string
}

export const AnswerFooterContext = createContext<AnswerFooterControls | null>(null)

/** The footer's drawer, for a trigger on its line; null outside an answer footer. */
export const useAnswerFooter = (): AnswerFooterControls | null => useContext(AnswerFooterContext)
