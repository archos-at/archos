import { redirect } from 'next/navigation'

export default async function SkillsRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  redirect(`/app/projects/${encodeURIComponent(id)}/automation?tab=skills`)
}
