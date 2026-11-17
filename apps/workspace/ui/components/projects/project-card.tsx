'use client'

import type { JSX } from 'react'
import { RaisedCard, RaisedCardBody, RaisedCardFooter } from '@/components/ui/raised-card'
import type { Project } from '@/lib/db/schema/projects'
import {
  ProjectActivity,
  ProjectOpenLink,
  ProjectMailWaiting,
  ProjectOverviewLink,
  ProjectLocationLine,
} from './project-atoms'
import { ProjectStatusMark } from './project-status'

interface ProjectCardProps {
  project: Project
  docCount?: number
  activityAt?: string
  // The caller passes mailWaiting only for a reader who may file the mail.
  mailWaiting?: number
}

export function ProjectCard({ project, docCount = 0, activityAt, mailWaiting = 0 }: ProjectCardProps): JSX.Element {
  void docCount

  return (
    <RaisedCard interactive>
      <RaisedCardBody>
        <div className="flex items-center justify-between gap-2.5">
          {/* `text-sm font-medium` is the ramp's card/subsection title — and
              it is what makes the rail outrank the list typographically rather
              than only by shape, since the row's name is `font-medium`. */}
          <h3 className="min-w-0 text-sm font-medium">
            <ProjectOpenLink project={project} />
          </h3>
          {/* Quiet while active, like the row: the rail holds active projects, so
              a chip here is the exception (ADR-0098). */}
          <ProjectStatusMark project={project} size="md" />
        </div>

        <ProjectLocationLine project={project} className="mt-0.5" />
      </RaisedCardBody>

      {/* Footer tab on the tray: activity · time · Übersicht. */}
      <RaisedCardFooter>
        <ProjectActivity project={project} activityAt={activityAt} compact />
        <ProjectMailWaiting project={project} count={mailWaiting} className="ml-auto" />
        <ProjectOverviewLink project={project} showLabel className={mailWaiting > 0 ? '-mr-2' : '-mr-2 ml-auto'} />
      </RaisedCardFooter>
    </RaisedCard>
  )
}
