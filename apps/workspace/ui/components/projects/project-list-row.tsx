'use client'

import type { JSX } from 'react'
import { Item } from '@/components/ui/item'
import type { Project } from '@/lib/db/schema/projects'
import { ProjectStatusMark } from './project-status'
import {
  ProjectActivity,
  ProjectDocCount,
  ProjectInitialsTile,
  ProjectOpenLink,
  ProjectOverviewLink,
  ProjectLocationLine,
} from './project-atoms'

interface ProjectListRowProps {
  project: Project
  docCount?: number
  activityAt?: string
}

export function ProjectListRow({ project, docCount = 0, activityAt }: ProjectListRowProps): JSX.Element {
  return (
    <Item as="li" className="group relative gap-3 px-3 py-2.5 has-[a:focus-visible]:bg-hover">
      {/* Hidden on phones: indexing a single narrow column by initials is worth
          less than the 48px it takes from names that are already truncating. */}
      <ProjectInitialsTile project={project} className="hidden sm:grid" />

      <div className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="min-w-0">
            <ProjectOpenLink project={project} className="after:rounded-none" />
          </span>
          <ProjectStatusMark project={project} />
        </span>
        <ProjectLocationLine project={project} className="mt-0.5" />
      </div>

      {/* Left-aligned inside its fixed column: right-aligning an icon+text pair
          whose text width varies ("1 document" … "24 documents") staggers the
          ICON, which is the thing the eye actually indexes the column by. The
          ragged edge falls on the word instead, where nobody is scanning. */}
      <ProjectDocCount count={docCount} className="hidden w-[104px] shrink-0 lg:flex" />

      {/* The one meta column that survives to the narrowest screen: with the
          location truncated and the tile gone, "when was I last in this" is what is
          left to choose a row by. */}
      <span className="flex w-[104px] min-w-0 shrink-0 items-center gap-1.5">
        {/* The icon says whose clock this is (a speech bubble for the viewer's own
            last message, a clock for the project's); the words go to assistive
            tech and the tooltip, where a 393px row has no room for them. */}
        <ProjectActivity project={project} activityAt={activityAt} compact />
      </span>

      <ProjectOverviewLink project={project} className="-mr-1.5 shrink-0" />
    </Item>
  )
}
