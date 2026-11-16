'use client'

import type { FC } from 'react'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import { cn } from '@/lib/utils'

export type UploadDestination = 'project' | 'session'

export interface UploadDestinationCopy {
  label: string
  labelLower: string
  sentence: string
}

export function useUploadDestination(target: UploadDestination): UploadDestinationCopy {
  const t = useTranslations(researchCopy)
  const isProject = target === 'project'
  const label = t(isProject ? 'fileSourcesTab.targetProject' : 'fileSourcesTab.targetSession')
  const labelLower = t(
    isProject ? 'fileSourcesTab.targetProjectLower' : 'fileSourcesTab.targetSessionLower'
  )
  return {
    label,
    labelLower,
    sentence: t('fileSourcesTab.filesGoTo', { target: labelLower }),
  }
}

export const UploadDestinationNote: FC<{
  target: UploadDestination
  className?: string
}> = ({ target, className }) => {
  const { sentence } = useUploadDestination(target)
  return (
    <p data-testid="upload-destination" className={cn('text-muted-foreground text-xs', className)}>
      {sentence}
    </p>
  )
}
