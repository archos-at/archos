import { redirect } from 'next/navigation'

interface ProjectPageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: ProjectPageProps): Promise<never> {
  const { id } = await params
  redirect(`/app/projects/${id}/chat`)
}
