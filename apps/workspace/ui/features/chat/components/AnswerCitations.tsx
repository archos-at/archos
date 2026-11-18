'use client'

import { useEffect, useMemo, useRef, useSyncExternalStore, type FC, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { InPageAnchorProvider } from '@/shared/components/MarkdownRenderer/anchor-context'
import {
  ExcerptSourceProvider,
  MarkdownRowActionProvider,
  type ExcerptSourceRenderer,
  type RowActionRenderer,
} from '@/shared/components/MarkdownRenderer/answer-block-context'
import { AskAboutChip } from '@/features/cards/components/AskAboutChip'
import { CitationExcerptSource } from './CitationExcerptSource'
import { InternalLinkProvider } from '@/shared/components/MarkdownRenderer/internal-link-context'
import { IfcElementChip } from '@/features/bim/components/ifc-element-chip'
import { parseElementLink } from '@/features/bim/lib/element-question'
import {
  CITATION_PARAM,
  parseCitationLink,
  referencesByNumber,
  resolveCitationLink,
  type CitationRef,
  type CitedDocument,
} from '../lib/citations'
import { CitationScope } from './CitationScope'
import { CitationMarker } from './CitationMarker'
import {
  DraftFileReference,
  FileReferenceLink,
  FileReferenceProvider,
  type FileReferenceResolver,
} from './FileReference'
import { SourceDocumentDialog } from './source-preview/source-document-dialog'
import { useChatStore } from '../store'
import { draftDownloadHref, draftFileName, draftLinkPath } from '../lib/draft-links'

const NO_FILE_REFERENCES: FileReferenceResolver = () => null

const excerptSourceRenderer = (documents: CitedDocument[]): ExcerptSourceRenderer => {
  const byNumber = referencesByNumber(documents)
  return function renderExcerptSource(props) {
    return byNumber.has(props.stamp?.number ?? props.number) || byNumber.has(props.number) ? (
      <CitationExcerptSource {...props} />
    ) : null
  }
}

const renderRowAction: RowActionRenderer = ({ subject, detail }) => (
  <AskAboutChip subject={subject} missing={detail} />
)

export const AnswerCitations: FC<{
  documents: CitedDocument[]
  anchorPrefix: string
  resolveFileReference?: FileReferenceResolver
  children: ReactNode
}> = ({ documents, anchorPrefix, resolveFileReference, children }) => {
  const linked = useLinkedCitation(documents)
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const renderExcerptSource = useMemo(() => excerptSourceRenderer(documents), [documents])

  return (
    <CitationScope documents={documents} anchorPrefix={anchorPrefix}>
      <FileReferenceProvider resolve={resolveFileReference ?? NO_FILE_REFERENCES}>
      <InPageAnchorProvider
        render={({ href, children: label }) => (
          <CitationMarker
            href={href}
            fallback={
              <FileReferenceLink
                href={href}
                fallback={
                  <a href={href} className="text-brand duration-quick underline underline-offset-2 transition-opacity ease-out hover:opacity-80">
                    {label}
                  </a>
                }
              >
                {label}
              </FileReferenceLink>
            }
          />
        )}
      >
        {/*
          A link the answer wrote into the app. A model deep link becomes an
          element chip — the answer names a wall and the reader can open it —
          and every other in-app link at least stops opening a second tab.
        */}
        <ExcerptSourceProvider render={renderExcerptSource}>
        <MarkdownRowActionProvider render={renderRowAction}>
        <InternalLinkProvider
          render={({ href, children: label }) => {
            const element = parseElementLink(href)
            if (element) {
              return <IfcElementChip link={element}>{label}</IfcElementChip>
            }
            if (draftLinkPath(href)) {
              const download = conversationId ? draftDownloadHref(conversationId, href) : null
              if (!download) return <span>{label}</span>
              return (
                <DraftFileReference href={download} fileName={draftFileName(href)}>
                  {label}
                </DraftFileReference>
              )
            }
            if (href.startsWith('/api/')) {
              return (
                <a
                  href={href}
                  download
                  className="text-brand duration-quick underline underline-offset-2 transition-opacity ease-out hover:opacity-80"
                >
                  {label}
                </a>
              )
            }
            return (
              <Link href={href} className="text-brand duration-quick underline underline-offset-2 transition-opacity ease-out hover:opacity-80">
                {label}
              </Link>
            )
          }}
        >
          {children}
        </InternalLinkProvider>
        </MarkdownRowActionProvider>
        </ExcerptSourceProvider>
      </InPageAnchorProvider>
      </FileReferenceProvider>
      {linked.ref && (
        <SourceDocumentDialog citation={linked.ref} onClose={linked.dismiss} />
      )}
    </CitationScope>
  )
}

const useLinkedCitation = (
  documents: CitedDocument[]
): { ref: CitationRef | null; dismiss: () => void } => {
  const params = useSearchParams()
  const value = params?.get(CITATION_PARAM) ?? null
  const claimant = useRef(0)
  if (claimant.current === 0) claimant.current = nextClaimant()
  const id = claimant.current
  const owner = useSyncExternalStore(subscribeToClaim, claimSnapshot, noOwner)

  const ref = value ? resolveCitationLink(parseCitationLink(value), documents) : null
  const holds = ref !== null

  useEffect(() => {
    if (!value || !holds) return
    claimLink(id, value)
    return () => releaseLink(id, value)
  }, [value, holds, id])

  useEffect(() => {
    if (value && holds && !owner) claimLink(id, value)
  }, [value, holds, owner, id])

  return {
    ref: value && owner === claimKey(value, id) ? ref : null,
    dismiss: () => value && dismissLink(value),
  }
}

const claim: { value: string | null; owner: number | null; dismissed: boolean } = {
  value: null,
  owner: null,
  dismissed: false,
}
const listeners = new Set<() => void>()

let claimants = 0
const nextClaimant = (): number => (claimants += 1)

const claimKey = (value: string, id: number): string => `${value}#${id}`
const noOwner = (): string => ''
const claimSnapshot = (): string =>
  claim.value !== null && claim.owner !== null && !claim.dismissed
    ? claimKey(claim.value, claim.owner)
    : ''

const subscribeToClaim = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const notify = (): void => listeners.forEach((listener) => listener())

const claimLink = (id: number, value: string): void => {
  if (claim.value !== value) {
    claim.value = value
    claim.owner = id
    claim.dismissed = false
    notify()
    return
  }
  if (claim.owner !== null || claim.dismissed) return
  claim.owner = id
  notify()
}

const releaseLink = (id: number, value: string): void => {
  if (claim.value !== value || claim.owner !== id) return
  claim.owner = null
  notify()
}

const dismissLink = (value: string): void => {
  claim.value = value
  claim.owner = null
  claim.dismissed = true
  notify()
}
