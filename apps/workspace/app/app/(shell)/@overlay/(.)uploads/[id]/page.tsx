import type { JSX } from 'react'
import { UploadSummaryDialog } from '@/features/uploads/components/upload-summary'

interface UploadSummaryOverlayPageProps {
  params: Promise<{ id: string }>
}

export default async function UploadSummaryOverlayPage({ params }: UploadSummaryOverlayPageProps): Promise<JSX.Element> {
  const { id } = await params
  return <UploadSummaryDialog batchId={id} standalone={false} />
}
