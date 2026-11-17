'use client'

import { createContext, useContext, type JSX, type ReactNode } from 'react'
import type { ProjectLifecycleView, ProjectStatus } from '@/lib/projects/project-status'

export interface CurrentProject {
  id: string
  name: string
  status: ProjectStatus
  closedAt: string | null
  readsBecauseClosed: boolean
  lifecycle?: ProjectLifecycleView
  canChangeStatus?: boolean
}

const CurrentProjectContext = createContext<CurrentProject | null>(null)

export function CurrentProjectProvider({ value, children }: { value: CurrentProject; children: ReactNode }): JSX.Element {
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>
}

export function useCurrentProject(): CurrentProject | null {
  return useContext(CurrentProjectContext)
}
