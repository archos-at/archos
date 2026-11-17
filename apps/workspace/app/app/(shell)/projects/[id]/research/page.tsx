import { redirect } from 'next/navigation'

interface ProjectResearchPageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectResearchPage({ params }: ProjectResearchPageProps): Promise<never> {
  const { id } = await params
  redirect(`/app/projects/${id}/chat`)
}
