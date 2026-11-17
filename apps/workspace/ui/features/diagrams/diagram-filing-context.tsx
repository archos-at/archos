'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface DiagramFilingTarget {
  projectId: string
  answerId: string
  conversationId?: string
  title?: string
}

const DiagramFilingContext = createContext<DiagramFilingTarget | null>(null)

export function DiagramFilingProvider({
  target,
  children,
}: {
  target: DiagramFilingTarget | null
  children: ReactNode
}) {
  return <DiagramFilingContext.Provider value={target}>{children}</DiagramFilingContext.Provider>
}

export function useDiagramFilingTarget(): DiagramFilingTarget | null {
  return useContext(DiagramFilingContext)
}

// The same answer and source always give the same run id, so filing twice finds the first filing.
export function diagramRunId(answerId: string, source: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${answerId}-${hash.toString(16).padStart(8, '0')}`
}
