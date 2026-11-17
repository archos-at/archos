'use client'

import type { ComponentType, ReactNode } from 'react'
import { createContext, useContext } from 'react'

export interface ResultRowFrameProps {
  href: string
  testId?: string
  className: string
  children: ReactNode
}
export const ResultRowFrameContext = createContext<ComponentType<ResultRowFrameProps> | null>(null)
export const ResultRowFrameProvider = ResultRowFrameContext.Provider

export function useCompactRow(): boolean {
  return useContext(ResultRowFrameContext) !== null
}
