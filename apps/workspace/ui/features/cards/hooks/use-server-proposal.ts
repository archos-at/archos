'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { proposalChannelKey, proposalEventSchema, type ProposalEvent } from '@/lib/proposals/live-events'
import type { ApplyProposalRequest, ProposedChangeKind, ProposedChangeView } from '@/lib/proposals/types'
import { useChannel } from '@/features/realtime/use-channel'
import { useDecidedProposals } from '../decided-proposals'
import { useProposalTransport } from './proposal-transport'

export type ProposalOfKind<K extends ProposedChangeKind> = Extract<ProposedChangeView, { kind: K }>

export type ProposalProblem = 'load' | 'apply' | 'dismiss'

type ProposalRead<K extends ProposedChangeKind> =
  | { status: 'loading' }
  | { status: 'loaded'; proposal: ProposalOfKind<K> }
  | { status: 'failed'; conflict: boolean }

export interface ProposalBusy {
  action: 'apply' | 'dismiss'
  withBody: boolean
}

export interface ServerProposal<K extends ProposedChangeKind> {
  proposal: ProposalOfKind<K> | null
  problem: ProposalProblem | null
  refusalCode: string | null
  busy: ProposalBusy | null
  overtaken: boolean
  decide: (action: 'apply' | 'dismiss', body?: ApplyProposalRequest) => Promise<void>
}

const isConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409

const refusalCodeOf = (error: unknown): string | null => {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null
  return typeof code === 'string' ? code : null
}

const isKind = <K extends ProposedChangeKind>(kind: K, proposal: ProposedChangeView): proposal is ProposalOfKind<K> =>
  proposal.kind === kind

export function useServerProposal<K extends ProposedChangeKind>(
  proposalId: string,
  kind: K,
  onSettled?: (proposal: ProposalOfKind<K>) => void
): ServerProposal<K> {
  const [read, setRead] = useState<ProposalRead<K>>({ status: 'loading' })
  const [refused, setRefused] = useState<'apply' | 'dismiss' | null>(null)
  const proposal = read.status === 'loaded' ? read.proposal : null
  const failed = read.status === 'failed'
  const problem: ProposalProblem | null = failed ? 'load' : refused
  const [refusalCode, setRefusalCode] = useState<string | null>(null)
  const [busy, setBusy] = useState<ProposalBusy | null>(null)
  const [overtaken, setOvertaken] = useState(false)
  const transport = useProposalTransport()

  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  const recordDecided = useDecidedProposals((state) => state.record)
  useEffect(() => {
    if (proposal) recordDecided(proposal)
  }, [proposal, recordDecided])

  const accept = useCallback(
    (read: ProposedChangeView): ProposalOfKind<K> | null => (isKind(kind, read) ? read : null),
    [kind]
  )

  useEffect(() => {
    let current = true
    transport.get(proposalId).then(
      (response) => {
        if (!current) return
        const proposal = accept(response.proposal)
        setRead(proposal ? { status: 'loaded', proposal } : { status: 'failed', conflict: false })
      },
      () => {
        if (current) setRead({ status: 'failed', conflict: false })
      }
    )
    return () => {
      current = false
    }
  }, [proposalId, accept, transport])

  const settle = useCallback((next: ProposalOfKind<K>): void => {
    setRead({ status: 'loaded', proposal: next })
    onSettledRef.current?.(next)
  }, [])

  const open = proposal?.status === 'proposed'
  const live = useRef({ open, busy, read })
  live.current = { open, busy, read }
  const reread = useCallback(() => {
    void transport.get(proposalId).then(
      (response) => {
        const { open: wasOpen, busy: deciding, read: was } = live.current
        const next = accept(response.proposal)
        if (deciding || !next) return
        if (was.status === 'failed') {
          if (was.conflict && next.status !== 'proposed') settle(next)
          else setRead({ status: 'loaded', proposal: next })
        } else if (wasOpen && next.status !== 'proposed') settle(next)
      },
      () => undefined
    )
  }, [proposalId, accept, settle, transport])
  useEffect(() => {
    if (!failed) return
    const onReturn = () => {
      if (document.visibilityState !== 'hidden') reread()
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [failed, reread])
  const channel = useChannel<ProposalEvent>(proposalChannelKey(proposalId), {
    enabled: (open || failed) && transport.live,
    parse: (event) => {
      const parsed = proposalEventSchema.safeParse(event)
      return parsed.success && parsed.data.proposalId === proposalId ? parsed.data : null
    },
    onEvent: reread,
  })
  const channelStatus = channel.status
  useEffect(() => {
    if (channelStatus === 'live') reread()
  }, [channelStatus, reread])
  const shownOpen = open && !transport.live
  useEffect(() => {
    if (shownOpen) reread()
  }, [shownOpen, reread])

  const inFlight = useRef(false)
  const decide = useCallback(
    async (action: 'apply' | 'dismiss', body?: ApplyProposalRequest): Promise<void> => {
      if (inFlight.current || live.current.busy) return
      inFlight.current = true
      setRefused(null)
      setRefusalCode(null)
      setBusy({ action, withBody: body !== undefined })
      try {
        const response = await (action === 'dismiss' ? transport.dismiss(proposalId) : transport.apply(proposalId, body))
        const decided = accept(response.proposal)
        if (decided) settle(decided)
        else setRefused(action)
      } catch (failure) {
        if (!isConflict(failure)) {
          setRefusalCode(refusalCodeOf(failure))
          setRefused(action)
          return
        }
        setOvertaken(true)
        await transport.get(proposalId).then(
          (response) => {
            const decided = accept(response.proposal)
            if (decided) settle(decided)
            else setRead({ status: 'failed', conflict: true })
          },
          () => setRead({ status: 'failed', conflict: true })
        )
      } finally {
        inFlight.current = false
        setBusy(null)
      }
    },
    [proposalId, accept, settle, transport]
  )

  return { proposal, problem, refusalCode, busy, overtaken, decide }
}
