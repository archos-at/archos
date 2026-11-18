import { redirect } from 'next/navigation'

interface ReferencesRedirectProps {
  params: Promise<{ id: string }>
}

export default async function ReferencesRedirect({
  params,
}: ReferencesRedirectProps): Promise<never> {
  const { id } = await params
  redirect(`/app/projects/${encodeURIComponent(id)}/settings/references`)
}
