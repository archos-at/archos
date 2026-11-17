import { redirect } from 'next/navigation'

interface ModelPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ModelPage({ params, searchParams }: ModelPageProps): Promise<never> {
  const [{ id }, query] = await Promise.all([params, searchParams])

  const forwarded = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const entry of value) forwarded.append(key, entry)
    else if (value !== undefined) forwarded.append(key, value)
  }

  const search = forwarded.toString()
  redirect(`/app/projects/${id}/files${search ? `?${search}` : ''}`)
}
