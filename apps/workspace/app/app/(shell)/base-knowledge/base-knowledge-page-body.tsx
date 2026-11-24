import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { BaseKnowledgeWorkspace } from '@/features/base-knowledge'
import { OfficeShelfPlaces } from '@/features/documents/components/office-shelf-places'

export async function BaseKnowledgePageBody(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    if (!isOfficeStandardsEnabled(session)) notFound()
    return (
      <div className="@container/section h-full min-h-0" data-testid="base-knowledge-page">
        <BaseKnowledgeWorkspace
          organizationName={session.organizationName}
          places={<OfficeShelfPlaces />}
          uploadCollection={officeShelfCollectionName(session.organizationId)}
        />
      </div>
    )
  })
}
