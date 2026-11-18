'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface InternalLinkProps {
  href: string
  children: ReactNode
}

export type InternalLinkRenderer = (props: InternalLinkProps) => ReactNode

const InternalLinkContext = createContext<InternalLinkRenderer | null>(null)

export const InternalLinkProvider = ({
  render,
  children,
}: {
  render: InternalLinkRenderer
  children: ReactNode
}) => <InternalLinkContext.Provider value={render}>{children}</InternalLinkContext.Provider>

export const useInternalLinkRenderer = (): InternalLinkRenderer | null =>
  useContext(InternalLinkContext)

export const isInternalHref = (href: string | undefined): href is string =>
  typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')
