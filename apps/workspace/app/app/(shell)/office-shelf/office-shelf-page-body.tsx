import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { isIfcModelsEnabled, isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { OfficeShelfWorkspace } from '@/features/documents/components/office-shelf-workspace'
import { OfficeShelfPlaces } from '@/features/documents/components/office-shelf-places'
import { OfficeShelfWithNorms } from '@/features/base-knowledge'

export async function OfficeShelfPageBody(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const canManage = canManageOfficeShelf(session)
    const showModels = isIfcModelsEnabled(session)
    return (
      <div className="@container/section h-full min-h-0" data-testid="office-shelf-page">
        {isOfficeStandardsEnabled(session) ? (
          <OfficeShelfWithNorms
            canManage={canManage}
            showModels={showModels}
            organizationName={session.organizationName}
            places={<OfficeShelfPlaces />}
            normsInFolders
          />
        ) : (
          <OfficeShelfWorkspace canManage={canManage} showModels={showModels} organizationName={session.organizationName} />
        )}
      </div>
    )
  })
}
