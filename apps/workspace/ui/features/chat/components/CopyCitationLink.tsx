'use client'

import { type FC, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { citationShareUrl, type CitationRef } from '../lib/citations'
import { COPY_ACTION_CLASSES, CopiedAnnouncement, CopyActionFace } from './CopyCitation'

export const CopyCitationLinkButton: FC<{ citation: CitationRef; icon?: ReactNode }> = ({
  citation,
  icon,
}) => {
  const t = useTranslations(chatCopy)
  const [copied, flashCopied] = useTransientFlag()

  const handleCopy = async (): Promise<void> => {
    const url = citationShareUrl(citation, {
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
    })
    try {
      await navigator.clipboard.writeText(url)
      flashCopied()
    } catch {
      toast.error(t('answerSources.copyFailed'))
    }
  }

  return (
    <>
      <button data-attr="chat-copy"
        type="button"
        onClick={() => void handleCopy()}
        aria-label={t('citationPeek.copyLinkAria', { label: citation.document.title })}
        className={COPY_ACTION_CLASSES}
      >
        <CopyActionFace
          copied={copied}
          icon={icon}
          label={t('citationPeek.copyLink')}
          copiedLabel={t('answerSources.copied')}
        />
      </button>
      <CopiedAnnouncement copied={copied} />
    </>
  )
}
