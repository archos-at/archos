import { redirect } from 'next/navigation'
import { OVERVIEW_PARAM } from '@/components/shell/landing'

/** The overview is a window of the shell, not a page: a bookmark, a refresh or a redirect to `/app/projects` lands where
 *  `/app` would and opens it there. */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }): Promise<never> {
  const { new: newParam } = await searchParams
  redirect(`/app?${OVERVIEW_PARAM}=${newParam === '1' ? 'new' : '1'}`)
}
