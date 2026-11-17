'use client'

import type { JSX } from 'react'
import { useTranslations } from '@/i18n'
import { settingsCopy } from '@/i18n/namespaces/settings'
import { ProjectMemoryPanel } from '../project-memory-panel'

export interface MemorySettingsProps {
  projectId: string
  canWrite: boolean
}

export function MemorySettings({ projectId, canWrite }: MemorySettingsProps): JSX.Element {
  const t = useTranslations(settingsCopy)

  return (
    <div className="flex flex-col gap-4">
      <ProjectMemoryPanel projectId={projectId} readOnly={!canWrite} />
      {!canWrite && (
        <p className="text-muted-foreground text-xs">{t('project.memory.readOnlyHint')}</p>
      )}
    </div>
  )
}
