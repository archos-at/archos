'use client'

import { useEffect, useState } from 'react'
import { getKnowledgeBase } from '@/adapters/api/knowledge-client'
import type { CorpusFileCandidate } from './resolve-corpus-file'

let cache: Promise<CorpusFileCandidate[]> | null = null

function fetchCorpusFiles(): Promise<CorpusFileCandidate[]> {
  cache ??= getKnowledgeBase()
    .then((data) =>
      (Array.isArray(data.files) ? data.files : []).map((f: { fileName?: string; state?: string }) => ({
        fileName: String(f.fileName ?? ''),
        state: String(f.state ?? 'removed'),
      })),
    )
    .catch(() => [])
  return cache
}

export function resetCorpusFilesCache(): void {
  cache = null
}

export function useCorpusFiles(): CorpusFileCandidate[] {
  const [files, setFiles] = useState<CorpusFileCandidate[]>([])

  useEffect(() => {
    let cancelled = false
    void fetchCorpusFiles().then((result) => {
      if (!cancelled) setFiles(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return files
}
