'use client'

import { useTranslations } from '@/i18n'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'

/** While the canvas chunk loads, and in its place when it could not be loaded (offline, a stale deploy). */
export function CanvasLoading({ error }: { error?: Error | null }) {
  const t = useTranslations(diagramsCopy)
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm" role="status">
      {error ? t('sketch.loadFailed') : t('sketch.loading')}
    </div>
  )
}
