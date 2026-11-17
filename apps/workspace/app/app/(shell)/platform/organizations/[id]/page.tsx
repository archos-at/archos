import type { JSX } from 'react'
import { PlatformOrgUsageView } from './platform-org-usage'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PlatformOrganizationPage({ params }: PageProps): Promise<JSX.Element> {
  const { id } = await params
  return <PlatformOrgUsageView organizationId={id} />
}
