'use client'

/**
 * The text of one manifestation, on its change request (ADR-0165, "Texts are
 * attached in the request"): the file the edition points to, one click away
 * for the reviewer, with where it came from. In a draft, whoever may write
 * platform knowledge attaches it here: an upload, or a URL on a configured
 * source that the public-source fetcher fetches. The text is released with
 * the request, under the request's country; nothing is uploaded elsewhere.
 */

import type { JSX } from 'react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, FileText, Link2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { AttachedTextView } from '@/lib/base-knowledge/platform/text-wire'
import { countryName } from './change-request-format'

interface Props {
  requestId: string
  countryId: string
  /** The manifestation's record id, `manifestation:<key>`. */
  recordId: string
  text: AttachedTextView | undefined
  /** A draft, and the viewer may write platform knowledge. */
  canAttach: boolean
  onAttached: () => void
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string; details?: { hint?: string } } | null
  return [body?.error ?? String(response.status), body?.details?.hint].filter(Boolean).join(' ')
}

export function ManifestationText({ requestId, countryId, recordId, text, canAttach, onAttached }: Props): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fromUrl, setFromUrl] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [url, setUrl] = useState('')
  const manifestationKey = recordId.replace(/^manifestation:/, '')
  const base = `/api/platform/knowledge/change-requests/${requestId}/texts`

  const send = async (path: string, init: RequestInit) => {
    setBusy(true)
    try {
      const response = await fetch(path, { method: 'POST', ...init }).catch(() => null)
      if (!response?.ok) {
        toast.error(t('countryKnowledge.failed', { reason: response ? await refusal(response) : '0' }))
        return
      }
      const attached = (await response.json()) as { text: AttachedTextView }
      toast.success(t('countryKnowledge.text.attached', { name: attached.text.corpusFile }))
      setFromUrl(false)
      setUrl('')
      onAttached()
    } finally {
      setBusy(false)
    }
  }

  const upload = (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    form.append('manifestationKey', manifestationKey)
    void send(`${base}/upload`, { body: form })
  }

  const importFromUrl = () =>
    void send(base, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifestationKey, sourceId: sourceId.trim(), url: url.trim() }),
    })

  return (
    <div className="bg-muted/50 flex flex-col gap-2 rounded-md p-3" data-testid="manifestation-text">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t('countryKnowledge.text.label')}</span>
        {text ? (
          <>
            <a
              href={`${base}/${encodeURIComponent(manifestationKey)}`}
              target="_blank"
              rel="noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
            >
              <FileText className="size-3.5" aria-hidden />
              {text.corpusFile}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {text.origin === 'url' && text.url ? (
              <a href={text.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline underline-offset-2">
                {t('countryKnowledge.text.fetched', { host: hostOf(text.url) })}
              </a>
            ) : (
              <span className="text-muted-foreground">{t(text.origin === 'upload' ? 'countryKnowledge.text.uploaded' : 'countryKnowledge.text.named')}</span>
            )}
            {text.pages ? <span className="text-muted-foreground tabular-nums">{t('countryKnowledge.text.pages', { count: text.pages })}</span> : null}
          </>
        ) : (
          <span className="text-foreground">{t(canAttach ? 'countryKnowledge.text.missing' : 'countryKnowledge.text.none')}</span>
        )}
      </div>
      {canAttach ? (
        <>
          <p className="text-muted-foreground text-xs">{t('countryKnowledge.text.attachHint', { country: countryName(countryId, locale) })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={picker}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              aria-label={t('countryKnowledge.text.upload')}
              data-testid="manifestation-text-file"
              onChange={(event) => {
                upload(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => picker.current?.click()}>
              <Upload aria-hidden />
              {t(text ? 'countryKnowledge.text.replace' : 'countryKnowledge.text.upload')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} aria-expanded={fromUrl} onClick={() => setFromUrl((open) => !open)}>
              <Link2 aria-hidden />
              {t('countryKnowledge.text.fromUrl')}
            </Button>
          </div>
          {fromUrl ? (
            <form
              className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault()
                importFromUrl()
              }}
            >
              <Input
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                placeholder={t('countryKnowledge.text.sourcePlaceholder')}
                aria-label={t('countryKnowledge.text.sourceLabel')}
                required
              />
              <Input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
                aria-label={t('countryKnowledge.text.urlLabel')}
                required
              />
              <Button type="submit" size="sm" disabled={busy || !sourceId.trim() || !url.trim()}>
                {t('countryKnowledge.text.fetch')}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
