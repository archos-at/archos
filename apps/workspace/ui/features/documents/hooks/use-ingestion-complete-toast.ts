'use client'

import { useEffect, useRef } from 'react'
import { isCitableStatus } from '../components/document-status'

interface StatusTrackedFile {
  id: string
  status: string | null
}

export function useIngestionCompleteToast<T extends StatusTrackedFile>(
  files: T[],
  onCitable: (file: T) => void
): void {
  const previousStatuses = useRef<Map<string, string | null>>(new Map())
  const alreadyToasted = useRef<Set<string>>(new Set())
  const onCitableRef = useRef<(file: T) => void>(onCitable)
  onCitableRef.current = onCitable

  useEffect(() => {
    const previous = previousStatuses.current
    for (const file of files) {
      const seenBefore = previous.has(file.id)
      const wasCitable = isCitableStatus(previous.get(file.id))
      if (seenBefore && !wasCitable && isCitableStatus(file.status) && !alreadyToasted.current.has(file.id)) {
        alreadyToasted.current.add(file.id)
        onCitableRef.current(file)
      }
    }

    const next = new Map<string, string | null>()
    for (const file of files) next.set(file.id, file.status)
    previousStatuses.current = next
  }, [files])
}
