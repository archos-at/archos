'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { DISCIPLINE_TAGS, DOCUMENT_TYPE_TAGS, MAX_TAGS, tagLabel } from '@/lib/documents/tag-vocabulary'

const ALL_VOCABULARY_TAGS: readonly string[] = [...DOCUMENT_TYPE_TAGS, ...DISCIPLINE_TAGS]

export function DocumentTagsEditor({
  fileId,
  initialTags,
  onTagsUpdated,
  readOnly = false,
}: {
  fileId: string
  initialTags: string[]
  onTagsUpdated?: (fileId: string, tags: string[]) => void
  readOnly?: boolean
}) {
  const t = useTranslations(filesCopy)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [input, setInput] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTags(initialTags)
    setInput('')
    setIsEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  const initialKey = initialTags.join('\u0000')
  const savingRef = useRef(false)
  savingRef.current = isSaving
  useEffect(() => {
    if (savingRef.current) return
    setTags(initialTags)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const persist = useCallback(
    async (next: string[], previous: string[]) => {
      setTags(next)
      setIsSaving(true)
      try {
        const res = await fetch(`/api/documents/${fileId}/tags`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: next }),
        })
        if (!res.ok) throw new Error(`Tag update failed (${res.status})`)
        onTagsUpdated?.(fileId, next)
      } catch {
        setTags(previous)
        toast.error(t('preview.tagsSaveError'))
      } finally {
        setIsSaving(false)
      }
    },
    [fileId, onTagsUpdated, t]
  )

  const removeTag = useCallback(
    (tag: string) => {
      void persist(
        tags.filter((existing) => existing !== tag),
        tags
      )
    },
    [persist, tags]
  )

  const addTag = useCallback(
    (tag: string) => {
      if (tags.includes(tag) || tags.length >= MAX_TAGS) return
      setInput('')
      void persist([...tags, tag], tags)
    },
    [persist, tags]
  )

  const labelOf = useCallback((tag: string) => tagLabel(tag, t), [t])

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase()
    const available = ALL_VOCABULARY_TAGS.filter((tag) => !tags.includes(tag))
    return q ? available.filter((tag) => labelOf(tag).toLowerCase().includes(q) || tag.toLowerCase().includes(q)) : available
  }, [input, tags, labelOf])

  const resolveInput = useCallback((): string | null => {
    const q = input.trim().toLowerCase()
    if (!q) return null
    const exact = ALL_VOCABULARY_TAGS.find((tag) => labelOf(tag).toLowerCase() === q || tag.toLowerCase() === q)
    if (exact && !tags.includes(exact)) return exact
    return suggestions.length === 1 ? suggestions[0] : null
  }, [input, suggestions, tags, labelOf])

  const atCap = tags.length >= MAX_TAGS
  const showNoMatchHint = isEditing && input.trim() !== '' && suggestions.length === 0

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">{t('preview.tags')}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-xs font-medium"
          >
            {labelOf(tag)}
            {!readOnly && (
              <button data-attr="files-remove-tag"
                type="button"
                onClick={() => removeTag(tag)}
                disabled={isSaving}
                aria-label={t('preview.removeTag', { tag: labelOf(tag) })}
                className="duration-snap hover:bg-hover hover:text-foreground focus-visible:ring-ring touch-target -mr-0.5 rounded-control p-0.5 transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 motion-reduce:transition-none"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && readOnly && (
          <span className="text-muted-foreground text-xs">{t('preview.noTags')}</span>
        )}
        {!readOnly && !atCap && (
          <span className="relative inline-flex items-center">
            {/* Follows the field's own left padding, which grows with it. */}
            <Plus
              className="text-muted-foreground pointer-coarse:left-3 pointer-events-none absolute left-1.5 size-3"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setIsEditing(true)}
              onBlur={() => {
                const resolved = resolveInput()
                if (resolved) addTag(resolved)
                else setInput('')
                setIsEditing(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const resolved = resolveInput()
                  if (resolved) addTag(resolved)
                }
                if (e.key === 'Escape') {
                  setInput('')
                  setIsEditing(false)
                  inputRef.current?.blur()
                }
              }}
              disabled={isSaving}
              placeholder={t('preview.addTagPlaceholder')}
              aria-label={t('preview.addTagLabel')}
              className="border-input text-foreground placeholder:text-muted-foreground focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:w-36 pointer-coarse:pl-8 pointer-coarse:text-base h-6 w-28 rounded-control border border-dashed bg-transparent pl-6 pr-1.5 text-xs focus-visible:border-solid focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
            />
          </span>
        )}
      </div>
      {/* Controlled-vocabulary suggestions while the input is active: the PATCH
          endpoint rejects free-form values, so offer the real choices. */}
      {!readOnly && isEditing && suggestions.length > 0 && (
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={t('preview.suggestionsLabel')}
        >
          {suggestions.map((tag) => (
            <button data-attr="files-add-tag"
              key={tag}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(tag)}
              disabled={isSaving}
              className="border-border text-muted-foreground duration-snap hover:bg-hover hover:text-foreground focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:px-3.5 inline-flex items-center rounded-control border bg-transparent px-2 py-0.5 text-xs font-medium transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 motion-reduce:transition-none"
            >
              {labelOf(tag)}
            </button>
          ))}
        </div>
      )}
      {showNoMatchHint && (
        <p className="text-muted-foreground text-xs">{t('preview.noTagMatch')}</p>
      )}
    </div>
  )
}
