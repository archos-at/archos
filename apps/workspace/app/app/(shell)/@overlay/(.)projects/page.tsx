import type { JSX } from 'react'
import { ProjectOverviewSheet } from '../../projects/project-overview-sheet'

export default async function ProjectOverviewOverlayPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>
}): Promise<JSX.Element> {
  const { new: newParam } = await searchParams
  return <ProjectOverviewSheet standalone={false} autoOpenCreate={newParam === '1'} />
}
