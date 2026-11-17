import type { JSX } from 'react'
import { type Metadata } from 'next'
import { withPageSession } from '@/lib/auth/require-auth'
import { getTranslations } from '@/i18n/server'
import { uploadBatchesCopy } from '@/i18n/namespaces/upload-batches'
import { UploadSummaryDialog } from '@/features/uploads/components/upload-summary'

interface UploadSummaryPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(uploadBatchesCopy)
  return { title: t('summary.title') }
}

export default async function UploadSummaryPage({ params }: UploadSummaryPageProps): Promise<JSX.Element> {
  return withPageSession(async () => {
    const { id } = await params
    return <UploadSummaryDialog batchId={id} standalone />
  })
}
