import { type FC } from 'react'
import { usePathname } from 'next/navigation'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useChatStore } from '@/features/chat/store'
import { useElapsedSeconds, formatElapsed } from '@/features/chat'
import { cn } from '@/lib/utils'
import { THREAD_COLUMN, THREAD_GUTTER } from '@/components/ui/thread-column'
import { useAuth } from '@/adapters/auth'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { filesCopy } from '@/i18n/namespaces/files'
import { researchCopy } from '@/i18n/namespaces/research'
import { projectIdFromPathname } from '@/components/shell'
import { useInboundMailWaitingShown } from '@/hooks/use-inbound-mail-waiting'
import { inboundMailPaths } from '@/lib/inbound-mail/paths'
import { InboundMailWaitingLine } from '@/features/documents'
import { WELCOME_OFFSET_FALLBACK } from '../../hooks/use-composer-metrics'
import { TOOLBAR_CLEAR_PADDING } from '../../lib/toolbar-clearance'

export const UnreadDivider: FC<{ label: string }> = ({ label }) => (
  <div
    className="flex items-center gap-3"
    role="separator"
    aria-label={label}
    data-testid="unread-divider"
  >
    <span className="bg-border h-px flex-1" aria-hidden="true" />
    <SectionLabel>{label}</SectionLabel>
    <span className="bg-border h-px flex-1" aria-hidden="true" />
  </div>
)

export const TurnInFlightBanner: FC<{ label: string }> = ({ label }) => (
  <div
    className="bg-card flex min-h-9 w-fit items-center gap-2 rounded-surface px-3.5 py-2 shadow-xs"
    role="status"
    data-testid="turn-in-flight"
  >
    <ShimmerText className="text-xs font-medium">{label}</ShimmerText>
  </div>
)

export const TypingIndicator: FC = () => {
  const t = useTranslations(researchCopy)
  const label = t('chatArea.status.thinking')
  const elapsed = useElapsedSeconds(true)
  return (
    <div
      className="animate-in fade-in-0 bg-muted duration-base flex min-h-9 w-fit items-center gap-2 rounded-bubble px-3.5 py-2.5 ease-out motion-reduce:animate-none"
      role="status"
      aria-label={label}
    >
      <span className="flex items-center gap-1 motion-reduce:hidden" aria-hidden="true">
        {/* CSS, not a JS loop: transform and opacity run on the compositor,
            so the dots cost the main thread nothing while a phone waits. */}
        <span className="animate-typing-dot bg-muted-foreground/70 size-1.5 rounded-full" />
        <span className="animate-typing-dot bg-muted-foreground/70 size-1.5 rounded-full" />
        <span className="animate-typing-dot bg-muted-foreground/70 size-1.5 rounded-full" />
      </span>
      <span
        className="text-muted-foreground hidden text-xs motion-reduce:inline"
        aria-hidden="true"
      >
        …
      </span>
      {/* Always word the wait (shimmering), and surface elapsed seconds once
          past a couple of seconds so a slow first token never feels stalled. */}
      <ShimmerText className="text-xs font-medium">{label}</ShimmerText>
      {/* aria-hidden: inside a status region, a figure that changes every
          second was re-announced every second. */}
      {elapsed > 2 && (
        <span className="text-muted-foreground text-xs tabular-nums" aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      )}
    </div>
  )
}

export const MessageListSkeleton: FC = () => {
  const t = useTranslations(researchCopy)
  return (
    <div
      className={cn(
        THREAD_COLUMN,
        THREAD_GUTTER,
        'flex flex-col gap-4',
        TOOLBAR_CLEAR_PADDING
      )}
      style={{ paddingBottom: 'calc(var(--composer-h, 11rem) + 1.5rem)' }}
      role="status"
      aria-label={t('chatArea.loading')}
      aria-busy="true"
    >
      {/* user bubble (right) */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/2 rounded-control" />
      </div>
      {/* assistant answer card (left): a tab-width bar and a footer line around
          the body, mirroring the answer card's shape rather than a bare slab */}
      <div className="flex justify-start">
        <div className="flex w-4/5 flex-col gap-2">
          <Skeleton className="h-4 w-20 rounded-control" />
          <Skeleton className="h-24 w-full rounded-control" />
          <Skeleton className="h-3 w-1/3 rounded-control" />
        </div>
      </div>
      {/* user bubble (right) */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/3 rounded-control" />
      </div>
    </div>
  )
}

interface WelcomeStateProps {
  isAuthenticated?: boolean
  onSignIn?: () => void
  inProject?: boolean
}

const greetingKeyForHour = (hour: number): 'morning' | 'afternoon' | 'evening' => {
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export const WelcomeState: FC<WelcomeStateProps> = ({
  isAuthenticated = false,
  onSignIn,
  inProject = false,
}) => {
  const t = useTranslations(researchCopy)
  const tChat = useTranslations(chatCopy)
  const { user } = useAuth()
  const composerSubject = useChatStore((s) => s.composerSubject)
  const tFiles = useTranslations(filesCopy)
  const projectId = projectIdFromPathname(usePathname() ?? '')
  const waitingMail = useInboundMailWaitingShown(inProject ? projectId : null)

  if (!isAuthenticated) {
    return (
      <div
        className="flex flex-1 items-end justify-center px-4 pt-20 sm:pt-16"
        style={{ paddingBottom: `var(--welcome-offset, ${WELCOME_OFFSET_FALLBACK})` }}
      >
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <div className="bg-muted text-brand flex size-12 items-center justify-center rounded-surface border">
            <Lock className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-medium">{t('chatArea.loggedOutTitle')}</h1>
          <p className="text-muted-foreground text-sm">{t('chatArea.loggedOutBody')}</p>
          <Button onClick={onSignIn} aria-label={t('chatArea.signInSso')}>
            {t('chatArea.signInSso')}
          </Button>
        </div>
      </div>
    )
  }

  const greeting = tChat(`greeting.${greetingKeyForHour(new Date().getHours())}`)
  const firstName = user?.name?.trim().split(/\s+/)[0]
  const heading = firstName ? tChat('greeting.withName', { greeting, name: firstName }) : greeting

  return (
    <div
      className="flex flex-1 flex-col items-center justify-end px-6 pt-20 sm:pt-16"
      style={{ paddingBottom: `var(--welcome-offset, ${WELCOME_OFFSET_FALLBACK})` }}
    >
      {/* Hero greeting — the one larger moment in the app, and the only place
          the ramp's 23px step is used (design language, "Type ramp"). The
          project-grounded starters live in their own plan (categorized,
          backend-driven) — until they land, the canvas stays quiet rather
          than showing static examples. */}
      <h1 className="text-foreground text-center text-[23px] font-medium">
        {heading}
      </h1>

      {/* The chat is about one file: say which. A named file is the state of
          THIS canvas, and it is not recoverable from anything else on
          screen. */}
      {composerSubject && (
        <p className="text-muted-foreground mt-2 max-w-md text-center text-sm leading-relaxed">
          {tFiles('assignment.welcomeAbout', {
            name: composerSubject.title?.trim() || tFiles('assignment.thisFile'),
          })}
        </p>
      )}

      {/* One sentence, and only in a project: that the agent WRITES. The canvas is
          otherwise deliberately quiet (the starters were cut for costing every
          user on every new thread), and this earns its place because it is the
          product's least discoverable capability — today it is found only by
          someone who happens to phrase a request as a commission (ledger 23).
          Below the file line, because a named subject is the state of THIS
          canvas and this is a standing fact about the project.

          Not shown when the thread is about one file: that reader has already
          been told what this canvas is for, and two grey sentences under a
          greeting is a paragraph. */}
      {inProject && !composerSubject && (
        <p className="text-muted-foreground mt-3 max-w-md text-center text-sm leading-relaxed">
          {tChat('greeting.projectWrites')}
        </p>
      )}

      {/* What waits for this reader at the project's start (the UI revision's „what happened since your last
          visit“, its first line): mail to file, the rail's own number, quiet, and only while something waits. */}
      {inProject && projectId && (waitingMail.count ?? 0) > 0 && (
        <div className="mt-4">
          <InboundMailWaitingLine
            href={inboundMailPaths(projectId).list({ status: 'waiting', outcome: null })}
            count={waitingMail.count ?? 0}
            more={waitingMail.more}
          />
        </div>
      )}
    </div>
  )
}
