import type { JSX } from 'react'
import { type Metadata } from 'next'
import { withPageSession } from '@/lib/auth/require-auth'
import { getTranslations } from '@/i18n/server'
import { InboundMailWorkspace } from '@/features/inbound-mail/components/inbound-mail-workspace'
import { loadInboundMailPage } from './_page-data'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

interface InboundMailPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(inboundMailCopy)
  return { title: t('title') }
}

export default async function InboundMailPage({ params, searchParams }: InboundMailPageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    const data = await loadInboundMailPage(session, id, await searchParams, null)
    return (
      <InboundMailWorkspace
        projectId={id}
        projectName={data.projectName}
        projectClosed={data.projectClosed}
        folders={data.folders}
        status={data.status}
        outcome={data.outcome}
        initialList={data.list}
        initialListFailed={data.list === null}
        mailId={null}
        initialMail={null}
      />
    )
  })
}
