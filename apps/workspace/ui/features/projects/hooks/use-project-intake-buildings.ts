import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'

import { BUILDING_ID_PREFIX, type BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import type { ProjectProfile } from '@/lib/project-profile/types'

import type { Answers } from '../components/project-intake-helpers'
import {
  persistedBuildingIds,
  withoutBuilding,
  withoutPendingBind,
  withPendingBind,
  type PendingRoleBind,
} from '../lib/pending-role-binds'
import { withoutBuildingAnswers } from '../lib/project-intake-building-answers'

interface UseProjectIntakeBuildingsOptions {
  initialProfile: ProjectProfile | null
  definition: ProjectIntakeDefinition | null
  buildingCounter: { current: number }
  setBuildings: Dispatch<SetStateAction<BuildingInstance[]>>
  setAnswers: Dispatch<SetStateAction<Answers>>
  updatePendingBinds: (next: (previous: PendingRoleBind[]) => PendingRoleBind[]) => void
}

export function useProjectIntakeBuildings({
  initialProfile,
  definition,
  buildingCounter,
  setBuildings,
  setAnswers,
  updatePendingBinds,
}: UseProjectIntakeBuildingsOptions) {
  const addBuilding = useCallback(() => {
    buildingCounter.current += 1
    const id = `${BUILDING_ID_PREFIX}${buildingCounter.current}`
    setBuildings((prev) => [...prev, { id, name: `Bauwerk ${prev.length + 1}` }])
  }, [buildingCounter, setBuildings])

  const removeBuilding = useCallback((id: string) => {
    setBuildings((prev) => (prev.length > 1 ? prev.filter((bw) => bw.id !== id) : prev))
    updatePendingBinds((prev) => withoutBuilding(prev, id))
    setAnswers((prev) => withoutBuildingAnswers(prev, id))
  }, [setBuildings, updatePendingBinds, setAnswers])

  const savedBuildingIds = useMemo(
    () => persistedBuildingIds(initialProfile, definition),
    [initialProfile, definition]
  )
  const deferBind = useCallback(
    (bind: PendingRoleBind) => updatePendingBinds((prev) => withPendingBind(prev, bind)),
    [updatePendingBinds]
  )
  const discardPendingBind = useCallback(
    (bind: PendingRoleBind) => updatePendingBinds((prev) => withoutPendingBind(prev, bind)),
    [updatePendingBinds]
  )

  const renameBuilding = useCallback((id: string, name: string) => {
    setBuildings((prev) => prev.map((bw) => (bw.id === id ? { ...bw, name } : bw)))
  }, [setBuildings])

  return {
    addBuilding,
    removeBuilding,
    renameBuilding,
    savedBuildingIds,
    deferBind,
    discardPendingBind,
  }
}
