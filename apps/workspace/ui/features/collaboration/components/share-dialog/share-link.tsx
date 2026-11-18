'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Check, Link2, Share } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { canShareNatively, passOnLink, type ShareLinkOutcome } from '../../lib/share-link'

export function ShareLink({ url }: { url: string }): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const [outcome, setOutcome] = useState<ShareLinkOutcome | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [native, setNative] = useState(false)
  useEffect(() => {
    setNative(canShareNatively())
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const pass = async (): Promise<void> => {
    const result = await passOnLink(url, t('sharing.link.shareTitle'))
    if (timer.current) clearTimeout(timer.current)
    setOutcome(result === 'cancelled' || result === 'shared' ? null : result)
    if (result === 'copied') timer.current = setTimeout(() => setOutcome(null), 2400)
  }

  const Icon = outcome === 'copied' ? Check : native ? Share : Link2
  return (
    <section className="space-y-2" data-testid="share-link">
      <SectionLabel as="h3">{t('sharing.link.heading')}</SectionLabel>
      <Button
        variant="secondary"
        className="w-full justify-center gap-2 sm:w-auto"
        onClick={() => void pass()}
        data-testid="share-link-button"
      >
        <Icon className="size-4" aria-hidden />
        {outcome === 'copied'
          ? t('sharing.link.copied')
          : native
            ? t('sharing.link.share')
            : t('sharing.link.copy')}
      </Button>
      <p role="status" className="text-xs leading-relaxed text-muted-foreground">
        {outcome === 'failed' ? (
          <span className="text-destructive">{t('sharing.link.failed')}</span>
        ) : (
          t('sharing.link.hint')
        )}
      </p>
    </section>
  )
}
