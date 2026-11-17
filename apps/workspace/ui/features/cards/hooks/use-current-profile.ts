'use client'

import { useEffect, useState } from 'react'
import type { ProjectProfile } from '@/lib/project-profile/types'

export function useCurrentProfile(projectId: string | null | undefined): ProjectProfile | null {
  const [loaded, setLoaded] = useState<{ projectId: string; profile: ProjectProfile } | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/profile`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.profile) setLoaded({ projectId, profile: data.profile as ProjectProfile })
      })
      .catch(() => {
        /* leave the profile null — the Before column stays hidden */
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  return projectId && loaded?.projectId === projectId ? loaded.profile : null
}
