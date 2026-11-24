import { redirect } from 'next/navigation'
import { binHrefOf } from '@/features/documents/lib/bin-href'

interface BinPageProps {
  params: Promise<{ id: string }>
}

export default async function FolderBinPage({ params }: BinPageProps): Promise<never> {
  const { id } = await params
  redirect(binHrefOf(`/app/projects/${id}/files`))
}
