'use client'

import type { JSX } from 'react'
import { UserPlus } from 'lucide-react'

import { PersonAvatar } from '@/components/ui/avatar-stack'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { ShareCandidate } from '@/lib/sharing/types'
import { cn } from '@/lib/utils'
import type { UseSharingResult } from '../../hooks/use-sharing'
import { isBlocked } from '../../lib/share-rules'

interface ShareCandidateRowProps {
  candidate: ShareCandidate
  saving: boolean
  grant: UseSharingResult['grant']
}

export function ShareCandidateRow({ candidate, saving, grant }: ShareCandidateRowProps): JSX.Element {
  const t = useTranslations(collaborationCopy)

  return (
    <li
      data-testid="share-candidate"
      data-blocked={isBlocked(candidate) || undefined}
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-snap ease-out hover:bg-hover motion-reduce:transition-none"
    >
      <PersonAvatar person={candidate.person} size="md" />
      {/* Identity is a COLUMN, and the right-hand slot is its
          sibling — never inline with the name. With the badge
          inside the name's line (`truncate` name beside a
          `shrink-0` chip) the chip won every contest for width
          and a narrow dialog rendered "E…" where a colleague's
          name should be. The one thing this row exists to show
          is who the person is. */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            isBlocked(candidate)
              ? 'text-foreground/70'
              : 'text-foreground',
          )}
        >
          {candidate.person.name}
        </p>
        {/* Always the email, on every row. It is what tells two
            same-named colleagues apart, so dropping it on the
            blocked row removed the identifying detail exactly
            where the reader has to make a decision. The reason
            the row is blocked is stated once below the list
            instead of once per row — same sentence, and it no
            longer turns a list item into a paragraph. */}
        <p className="truncate text-xs text-muted-foreground">
          {candidate.person.email ?? ''}
        </p>
        {/* Not in the project is one sentence for the whole list
            (below). This one is per person and exact: it is
            what the owner decided the row says, and it never
            names the folder — the sharer may not read it. */}
        {candidate.lacksFolderAccess === true && (
          <p
            data-testid="share-candidate-lacks-folder"
            className="text-xs leading-snug text-muted-foreground"
          >
            {t('sharing.invite.lacksFolderAccess')}
          </p>
        )}
      </div>
      {/* One slot on the right: the action, or the reason there
          isn't one. A disabled "Einladen" was a control that
          could never work no matter how often it was pressed —
          the badge says what to fix instead. */}
      {candidate.needsProjectAccess ? (
        <Chip variant="muted" size="sm" className="shrink-0 font-normal">
          {t('sharing.invite.needsProjectAccess')}
        </Chip>
      ) : candidate.lacksFolderAccess === true ? (
        <Chip variant="muted" size="sm" className="shrink-0 font-normal">
          {t('sharing.invite.lacksFolderAccessBadge')}
        </Chip>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={saving}
          aria-label={`${t('sharing.invite.submit')}: ${candidate.person.name}`}
          onClick={() => void grant(candidate.person.userId)}
        >
          <UserPlus className="size-3.5" aria-hidden />
          {t('sharing.invite.submit')}
        </Button>
      )}
    </li>
  )
}
