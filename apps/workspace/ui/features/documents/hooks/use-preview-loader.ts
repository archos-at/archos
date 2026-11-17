import { useCallback, useRef, useState } from 'react'
import type { FileItem } from '../file-types'

export function usePreviewLoader({
  file,
  canPreview,
  isTextual,
  isOfficeRendition,
}: {
  file: FileItem
  canPreview: boolean
  isTextual: boolean
  isOfficeRendition: boolean
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [renditionType, setRenditionType] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewGone, setPreviewGone] = useState(false)
  const [previewText, setPreviewText] = useState<{ text: string; truncated: boolean } | null>(null)

  const previewRequest = useRef<AbortController | null>(null)
  const loadPreview = useCallback(() => {
    previewRequest.current?.abort()
    const request = new AbortController()
    previewRequest.current = request
    const { signal } = request
    setPreviewFailed(false)
    setPreviewGone(false)
    setPreviewUrl(null)
    setPreviewImageUrl(null)

    if (isTextual) {
      setPreviewText(null)
      setIsLoading(true)
      let gone = false
      fetch(`/api/documents/${file.id}/text`, { signal })
        .then(async (r) => {
          if (r.status === 404) {
            gone = true
            return null
          }
          return r.ok ? await r.json() : null
        })
        .then((data) => {
          if (signal.aborted) return
          if (typeof data?.text === 'string') {
            setPreviewText({ text: data.text, truncated: data.truncated === true })
          } else if (gone) {
            setPreviewGone(true)
          } else {
            setPreviewFailed(true)
          }
        })
        .catch(() => {
          if (signal.aborted) return
          setPreviewText(null)
          setPreviewFailed(true)
        })
        .finally(() => {
          if (!signal.aborted) setIsLoading(false)
        })
      return
    }

    setPreviewText(null)
    if (!canPreview) return

    setIsLoading(true)
    setRenditionType(null)
    let gone = false
    let noRendition = false
    fetch(`/api/documents/${file.id}/preview`, { signal })
      .then(async (r) => {
        if (isOfficeRendition && (r.status === 415 || r.status === 502)) {
          noRendition = true
          return null
        }
        if (r.status === 404) {
          gone = true
          return null
        }
        return r.ok ? await r.json() : null
      })
      .then((data) => {
        if (signal.aborted) return
        if (isOfficeRendition && data?.url && data.contentType !== 'application/pdf') {
          noRendition = true
        }
        if (noRendition) return
        if (data?.url) {
          if (isOfficeRendition) setRenditionType(data.contentType)
          setPreviewUrl(data.url)
          setPreviewImageUrl(typeof data.imageUrl === 'string' ? data.imageUrl : null)
        } else if (gone) {
          setPreviewGone(true)
        } else {
          setPreviewFailed(true)
        }
      })
      .catch(() => {
        if (signal.aborted) return
        setPreviewFailed(true)
      })
      .finally(() => {
        if (!signal.aborted) setIsLoading(false)
      })
  }, [file.id, canPreview, isTextual, isOfficeRendition])

  const handlePdfFailed = useCallback(() => {
    setPreviewUrl(null)
    setPreviewImageUrl(null)
    setPreviewFailed(true)
  }, [])

  return {
    previewUrl,
    previewImageUrl,
    renditionType,
    isLoading,
    previewFailed,
    previewGone,
    previewText,
    setPreviewUrl,
    setPreviewImageUrl,
    setRenditionType,
    setIsLoading,
    setPreviewFailed,
    setPreviewGone,
    setPreviewText,
    previewRequest,
    loadPreview,
    handlePdfFailed,
  }
}
