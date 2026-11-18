'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { PostHogConfig, PostHogIdentity } from '@/lib/analytics/posthog-config'

export interface FileUploadConfig {
  acceptedTypes: string
  acceptedMimeTypes: string[]
  maxTotalSizeMB: number
  maxFileSize: number
  maxIfcFileSize: number
  maxTotalSize: number
  maxFileCount: number
  fileExpirationCheckIntervalHours: number
  imageUploadBlockedReason?: 'vlm-unavailable' | null
}

export interface AppConfig {
  authRequired: boolean
  fileUpload: FileUploadConfig
  posthog?: PostHogConfig
  posthogIdentity?: PostHogIdentity | null
  publicSiteUrl?: string | null
}

const AppConfigContext = createContext<AppConfig | null>(null)

interface AppConfigProviderProps {
  config: AppConfig
  children: ReactNode
}

export const AppConfigProvider = ({ config, children }: AppConfigProviderProps): ReactNode => {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>
}

export const usePublicSiteUrl = (): string | null => useContext(AppConfigContext)?.publicSiteUrl ?? null

export const useAppConfig = (): AppConfig => {
  const config = useContext(AppConfigContext)
  if (config === null) {
    throw new Error('useAppConfig must be used within an AppConfigProvider')
  }
  return config
}
