import type { JSX } from 'react'
import { withPageSession } from '@/lib/auth/require-auth'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { isIfcModelsEnabled, isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { PageSheetClose } from '@/components/ui/page-sheet'
import { RoutePageSheet } from '@/components/shell/route-page-sheet'
import { OfficeShelfWorkspace } from '@/features/documents/components/office-shelf-workspace'
import { OfficeShelfPlaces } from '@/features/documents/components/office-shelf-places'
import { OfficeShelfWithNorms } from '@/features/base-knowledge'

export async function OfficeShelfSheet({ standalone }: { standalone: boolean }): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(officeShelfCopy)
    const tCommon = await getTranslations(commonCopy)
    const canManage = canManageOfficeShelf(session)
    const showModels = isIfcModelsEnabled(session)

    return (
      <RoutePageSheet
        title={t('title')}
        subtitle={t('subtitle')}
        closeLabel={tCommon('actions.close')}
        headerless
        standalone={standalone}
      >
        {isOfficeStandardsEnabled(session) ? (
          <OfficeShelfWithNorms
            canManage={canManage}
            showModels={showModels}
            organizationName={session.organizationName}
            places={<OfficeShelfPlaces />}
            normsInFolders
            trailingActions={<PageSheetClose label={tCommon('actions.close')} />}
          />
        ) : (
          <OfficeShelfWorkspace
            canManage={canManage}
            showModels={showModels}
            organizationName={session.organizationName}
            trailingActions={<PageSheetClose label={tCommon('actions.close')} />}
          />
        )}
      </RoutePageSheet>
    )
  })
}
