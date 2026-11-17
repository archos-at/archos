'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface InPageAnchorProps {
  href: string
  children: ReactNode
}

export type InPageAnchorRenderer = (props: InPageAnchorProps) => ReactNode

const InPageAnchorContext = createContext<InPageAnchorRenderer | null>(null)

export const InPageAnchorProvider = ({
  render,
  children,
}: {
  render: InPageAnchorRenderer
  children: ReactNode
}) => <InPageAnchorContext.Provider value={render}>{children}</InPageAnchorContext.Provider>

export const useInPageAnchorRenderer = (): InPageAnchorRenderer | null =>
  useContext(InPageAnchorContext)

export const scrollToAnchor = (id: string): void => {
  const element = document.getElementById(id)
  if (!element) return
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}
