'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  storedFileIndex,
  type StoredFile,
} from '@/features/documents/hooks/use-surfaced-documents'
import { fileNamesPresentIn, mentionsAnyFileType } from '../lib/file-references'

export interface AnswerFileReferences {
  fileNames: readonly string[]
  resolve: (fileName: string) => StoredFile | null
}

const NO_NAMES: readonly string[] = []
const NAME_SEPARATOR = '\u0000'
const NO_REFERENCES: AnswerFileReferences = { fileNames: NO_NAMES, resolve: () => null }

export function useAnswerFileReferences(options: {
  body: string
  projectId: string | null
  conversationId: string | null
}): AnswerFileReferences {
  const { body, projectId, conversationId } = options
  const worthLooking = mentionsAnyFileType(body)
  const [index, setIndex] = useState<Map<string, StoredFile> | null>(null)

  useEffect(() => {
    if (!worthLooking) return
    let cancelled = false
    storedFileIndex(projectId, conversationId)
      .then((loaded) => {
        if (!cancelled) setIndex(loaded)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [worthLooking, projectId, conversationId])

  const namesKey = useMemo(
    () =>
      worthLooking && index
        ? fileNamesPresentIn(
            body,
            [...index.values()].map((entry) => entry.file.filename)
          ).join(NAME_SEPARATOR)
        : '',
    [worthLooking, index, body]
  )
  const fileNames = useMemo(
    () => (namesKey ? namesKey.split(NAME_SEPARATOR) : NO_NAMES),
    [namesKey]
  )

  return useMemo(() => {
    if (fileNames.length === 0) return NO_REFERENCES
    return {
      fileNames,
      resolve: (fileName: string) => index?.get(fileName.trim().toLowerCase()) ?? null,
    }
  }, [fileNames, index])
}
