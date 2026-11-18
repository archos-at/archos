'use client'

import type { JSX, ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

import type { PlatformPermission } from '@/lib/authz/permissions'

const PlatformAccessContext = createContext<ReadonlySet<string> | null>(null)

export function PlatformAccessProvider({
  permissions,
  children,
}: {
  permissions: readonly string[]
  children: ReactNode
}): JSX.Element {
  const value = useMemo(() => new Set(permissions), [permissions])
  return <PlatformAccessContext.Provider value={value}>{children}</PlatformAccessContext.Provider>
}

export function usePlatformCan(permission: PlatformPermission): boolean {
  const permissions = useContext(PlatformAccessContext)
  return permissions === null || permissions.has(permission)
}
