'use client'

import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { resolveDocClass, type DocClass } from '@/lib/knowledge/doc-class'
import type { KnowledgeFile } from '@/lib/knowledge/service'
import { useDocClassLabel } from '@/features/platform/components/knowledge-atoms'

export function useKnowledgeFileEdits({
  load,
  selected,
  setSelected,
  setDocClassOverrides,
  setDisplayTitleOverrides,
}: {
  load: () => Promise<void>
  selected: string[]
  setSelected: Dispatch<SetStateAction<string[]>>
  setDocClassOverrides: Dispatch<SetStateAction<Record<string, DocClass>>>
  setDisplayTitleOverrides: Dispatch<SetStateAction<Record<string, string>>>
}) {
  const t = useTranslations(platformCopy)
  const docClassLabel = useDocClassLabel()

  const patchDocClass = useCallback(
    async (fileName: string, nextClass: DocClass): Promise<boolean> => {
      setDocClassOverrides((prev) => ({ ...prev, [fileName]: nextClass }))
      try {
        const res = await fetch(
          `/api/platform/knowledge/documents/${encodeURIComponent(fileName)}/doc-class`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc_class: nextClass }),
          }
        )
        if (!res.ok) throw new Error(`Reclassify failed (${res.status})`)
        return true
      } catch {
        setDocClassOverrides((prev) => {
          const next = { ...prev }
          delete next[fileName]
          return next
        })
        return false
      }
    },
    []
  )

  const handleReclassify = useCallback(
    (file: KnowledgeFile, nextClass: DocClass) => {
      if (nextClass === resolveDocClass(file.docClass)) return
      void patchDocClass(file.fileName, nextClass).then(async (ok) => {
        if (!ok) {
          toast.error(t('knowledge.docClassUpdateFailed', { name: file.fileName }))
          return
        }
        toast.success(
          t('knowledge.docClassUpdated', { name: file.fileName, label: docClassLabel(nextClass) })
        )
        await load()
      })
    },
    [docClassLabel, patchDocClass, load, t]
  )

  const handleBulkReclassify = useCallback(
    (nextClass: DocClass) => {
      const names = [...selected]
      if (names.length === 0) return
      void Promise.all(names.map((name) => patchDocClass(name, nextClass))).then(
        async (results) => {
          const failed = results.filter((ok) => !ok).length
          const succeeded = results.length - failed
          if (succeeded > 0) {
            toast.success(
              t('knowledgeAdmin.bulkReclassifyDone', {
                count: succeeded,
                label: docClassLabel(nextClass),
              })
            )
          }
          if (failed > 0) toast.error(t('knowledgeAdmin.bulkReclassifyFailed', { count: failed }))
          setSelected([])
          await load()
        }
      )
    },
    [docClassLabel, selected, patchDocClass, load, t]
  )

  const handleRename = useCallback(
    (file: KnowledgeFile, draft: string) => {
      const nextTitle = draft.trim()
      if (nextTitle === (file.displayTitle ?? '').trim()) return
      const clear = () =>
        setDisplayTitleOverrides((prev) => {
          const next = { ...prev }
          delete next[file.fileName]
          return next
        })
      setDisplayTitleOverrides((prev) => ({ ...prev, [file.fileName]: nextTitle }))
      fetch(
        `/api/platform/knowledge/documents/${encodeURIComponent(file.fileName)}/display-title`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_title: nextTitle }),
        }
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(`Rename failed (${r.status})`)
          toast.success(t('knowledge.displayTitleUpdated', { name: file.fileName }))
          await load()
          clear()
        })
        .catch(() => {
          clear()
          toast.error(t('knowledge.displayTitleUpdateFailed', { name: file.fileName }))
        })
    },
    [load, t]
  )

  return { handleReclassify, handleBulkReclassify, handleRename }
}
