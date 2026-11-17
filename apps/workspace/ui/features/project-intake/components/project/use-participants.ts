'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParticipantsClient, ProjectBasics, ProjectRoster } from '@/lib/projects/participants-client'
import type { ProjectRecordView } from '@/lib/projects/project-record-types'

export interface ParticipantsState {
  loading: boolean
  project: ProjectBasics | null
  peopleRecord: ProjectRecordView | null
  roster: ProjectRoster | null
  reload: () => Promise<void>
}

export function useParticipants(projectId: string, client: ParticipantsClient): ParticipantsState {
  const [state, setState] = useState<Omit<ParticipantsState, 'reload'>>({
    loading: true,
    project: null,
    peopleRecord: null,
    roster: null,
  })
  const generation = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const mine = ++generation.current
    const [project, peopleRecord, roster] = await Promise.allSettled([
      client.project(projectId),
      client.peopleRecord(projectId),
      client.roster(projectId),
    ])
    if (mine !== generation.current) return
    setState((current) => ({
      loading: false,
      project: project.status === 'fulfilled' ? project.value : current.project,
      peopleRecord: peopleRecord.status === 'fulfilled' ? peopleRecord.value : current.peopleRecord,
      roster: roster.status === 'fulfilled' ? roster.value : current.roster,
    }))
  }, [client, projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}
