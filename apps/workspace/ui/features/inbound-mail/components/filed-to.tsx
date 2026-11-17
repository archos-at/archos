'use client'

import { CLAUSE_JOIN } from '@/lib/format'
import type { JSX } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Repeat2 } from 'lucide-react'
import { documentFilesHref } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { capturePosthog } from '@/lib/analytics/posthog'
import type { InboundMailPartView } from '@/lib/inbound-mail/inbound-mail-wire'
import { filedPlace } from '../lib/filed'
import { FactLine } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export function FiledTo({
  projectId,
  part,
  followed = false,
}: {
  projectId: string
  part: Pick<InboundMailPartView, 'kind' | 'documentId' | 'filedAs'>
  followed?: boolean
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const place = filedPlace(part, t('suggestion.root'))
  const words = (() => {
    if (part.kind === 'message') {
      if (!place) return followed ? t('message.followed') : t('message.filed')
      return followed ? t('message.followedTo', { name: place.name }) : t('message.filedTo', { name: place.name })
    }
    return place ? t('attachments.status.filedTo', { folder: place.folder }) : t('attachments.status.filed')
  })()
  return (
    <FactLine icon={followed ? Repeat2 : CheckCircle2} tone="default" testId={part.kind === 'message' ? 'message-filed' : 'status-filed'}>
      {words}
      {place?.version != null && `${CLAUSE_JOIN}${t('attachments.status.version', { version: place.version })}`}
      {part.documentId && (
        <>
          {CLAUSE_JOIN}
          <Button asChild variant="inline">
            <Link
              href={documentFilesHref(projectId, part.documentId)}
              onClick={() => capturePosthog('inbound_mail_filed_outcome_opened', { kind: part.kind })}
            >
              {t('attachments.open')}
            </Link>
          </Button>
        </>
      )}
    </FactLine>
  )
}
