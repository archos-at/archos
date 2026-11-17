'use client'

import type { JSX } from 'react'
import { ProjectMembersForm } from '@/components/projects/project-members-form'
import { useTranslations } from '@/i18n'
import { settingsCopy } from '@/i18n/namespaces/settings'
import { SettingsSectionIntro } from '@/components/settings/settings-panel'

export interface MembersSettingsProps {
  projectId: string
  currentMembershipId: string | null
}

export function MembersSettings({
  projectId,
  currentMembershipId,
}: MembersSettingsProps): JSX.Element {
  const t = useTranslations(settingsCopy)

  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionIntro
        title={t('project.members.title')}
        description={t('project.members.description')}
      />
      <ProjectMembersForm
        projectId={projectId}
        canManage
        currentMembershipId={currentMembershipId}
      />
    </div>
  )
}
