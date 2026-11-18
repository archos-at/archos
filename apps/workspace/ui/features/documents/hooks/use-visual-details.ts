import { useCallback, useEffect, useState } from 'react'
import type { FileItem } from '../file-types'
import type { VisualDetail } from '../components/page-readings'

export function useVisualDetails({
  file,
  showMetadataPanel,
  hasVisualContent,
  setShownPage,
  turnFrame,
}: {
  file: FileItem
  showMetadataPanel: boolean
  hasVisualContent: boolean
  setShownPage: (page: number | 'turning' | null) => void
  turnFrame: { current: number | null }
}) {
  const [details, setDetails] = useState<VisualDetail[] | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsFailed, setDetailsFailed] = useState(false)

  useEffect(() => {
    setDetails(null)
    setDetailsFailed(false)
    if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current)
    turnFrame.current = null
    setShownPage(null)
  }, [file.id])
  useEffect(
    () => () => {
      if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current)
    },
    [],
  )

  const detailsBasis = `${file.status ?? ''}|${(file.contentTypes ?? []).join(',')}`
  useEffect(() => {
    setDetails(null)
    setDetailsFailed(false)
  }, [detailsBasis])

  useEffect(() => {
    if (!showMetadataPanel || !hasVisualContent || details !== null) return
    let cancelled = false
    setDetailsLoading(true)
    fetch(`/api/documents/${file.id}/visual-details`)
      .then((r) => {
        if (!r.ok) throw new Error(`visual-details ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setDetails(Array.isArray(data?.details) ? data.details : [])
      })
      .catch(() => {
        if (cancelled) return
        setDetails([])
        setDetailsFailed(true)
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false)
      })
    return () => {
      cancelled = true
      setDetailsLoading(false)
    }
  }, [showMetadataPanel, hasVisualContent, details, file.id, detailsBasis])

  const retryDetails = useCallback(() => {
    setDetailsFailed(false)
    setDetails(null)
  }, [])

  return {
    details,
    detailsBasis,
    detailsFailed,
    detailsLoading,
    retryDetails,
    setDetails,
    setDetailsFailed,
    setDetailsLoading,
  }
}
