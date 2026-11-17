'use client'

import { isSystemFile } from '../lib/system-files'
import { useCallback, useRef, useState } from 'react'
import { loadUploadScreeningPolicy } from '@/adapters/api/upload-screening-policy'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { digestFiles } from '../lib/content-digest'
import type { RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import type { RevisionChange } from '../lib/revision-proposals'
import {
  buildFolderUploadPlan,
  continuesASeries,
  isFolderUpload,
  needsUploadDecision,
  type FolderUploadPlan,
  type FolderUploadPlanInput,
  type PlanDocument,
  type PlannedFile,
} from '../lib/folder-upload-plan'

export type PlanDocumentSource =
  | readonly PlanDocument[]
  | ((names: readonly string[]) => Promise<readonly PlanDocument[]>)

export type RevisionOfferSource = (
  names: readonly string[],
  landsIn: ReadonlyMap<string, string | null>,
) => Promise<readonly RevisionCandidateMatch[]>

export type UploadDecisionKind = 'folder' | 'files'

async function documentsFor(source: PlanDocumentSource, files: readonly File[]): Promise<readonly PlanDocument[]> {
  if (typeof source !== 'function') return source
  if (files.length === 0) return []
  return source([...new Set(files.map((file) => file.name))])
}

async function offersFor(
  source: RevisionOfferSource | undefined,
  files: readonly File[],
  planned: readonly PlannedFile[],
): Promise<readonly RevisionCandidateMatch[]> {
  const names = [...new Set(files.map((file) => file.name).filter(continuesASeries))]
  if (!source || names.length === 0) return []
  const wanted = new Set(names)
  const landsIn = new Map(
    planned.filter((entry) => wanted.has(entry.file.name)).map((entry) => [entry.file.name, entry.landsInFolderId ?? null] as const),
  )
  try {
    return await source(names, landsIn)
  } catch {
    return []
  }
}

function withOffers(input: FolderUploadPlanInput, found: readonly RevisionCandidateMatch[]): FolderUploadPlanInput {
  if (found.length === 0) return input
  return {
    ...input,
    revisionOffers: new Map([...(input.revisionOffers ?? []), ...found.map((offer) => [offer.name, offer] as const)]),
  }
}

function withDocuments(input: FolderUploadPlanInput, found: readonly PlanDocument[]): FolderUploadPlanInput {
  const known = new Set(input.documents.map((document) => document.id))
  return { ...input, documents: [...input.documents, ...found.filter((document) => !known.has(document.id))] }
}

export interface SettledPlan {
  plan: FolderUploadPlan
  policy: UploadScreeningPolicy
}

export interface UploadDecision {
  propose: (
    input: Omit<
      FolderUploadPlanInput,
      'documents' | 'digests' | 'screening' | 'revisionOffers' | 'revisionChoices'
    > & {
      documents: PlanDocumentSource
      revisionOffers?: RevisionOfferSource
      screeningBasePath?: string | null
    },
    sendDirect: (files: File[]) => void
  ) => Promise<void>
  setReleased: (file: File, released: boolean) => Promise<void>
  settle: () => Promise<SettledPlan | null>
  changeRevision: (change: RevisionChange) => void
  plan: FolderUploadPlan | null
  kind: UploadDecisionKind
  open: boolean
  setOpen: (open: boolean) => void
  pending: boolean
  setPending: (pending: boolean) => void
}

export function useUploadDecision(options: { projectId?: string | null } = {}): UploadDecision {
  const screeningProjectId = options.projectId ?? null
  const [plan, setPlan] = useState<FolderUploadPlan | null>(null)
  const [kind, setKind] = useState<UploadDecisionKind>('files')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const generation = useRef(0)
  const lastInput = useRef<FolderUploadPlanInput | null>(null)
  const lastSource = useRef<PlanDocumentSource>([])
  const lastOfferSource = useRef<RevisionOfferSource | undefined>(undefined)
  const probed = useRef<Set<string>>(new Set())
  const asking = useRef<Set<Promise<void>>>(new Set())

  const propose = useCallback<UploadDecision['propose']>(async (dropped, sendDirect) => {
    const input = { ...dropped, files: dropped.files.filter((file) => !isSystemFile(file.name)) }
    if (input.files.length === 0) return
    const current = ++generation.current
    const isFolder = isFolderUpload(input.files)
    const { screeningBasePath, documents: source, revisionOffers: offerSource, ...planInput } = input
    const policy = await loadUploadScreeningPolicy(screeningProjectId)
    if (current !== generation.current) return
    const screening = { policy, basePath: screeningBasePath ?? null, released: new Set<File>() }
    const screened = buildFolderUploadPlan({ ...planInput, documents: [], screening })
    const admitted = screened.files.filter((file) => file.action !== 'excluded').map((file) => file.file)
    const [documents, offers] = await Promise.all([
      documentsFor(source, admitted),
      offersFor(offerSource, admitted, screened.files),
    ])
    if (current !== generation.current) return
    lastSource.current = source
    lastOfferSource.current = offerSource
    probed.current = new Set(admitted.map((file) => file.name))
    asking.current = new Set()
    const base = withOffers({ ...planInput, documents, screening }, offers)
    const first = buildFolderUploadPlan(base)
    if (!isFolder && !needsUploadDecision(first)) {
      lastInput.current = null
      sendDirect([...input.files])
      return
    }
    setKind(isFolder ? 'folder' : 'files')
    setPlan(null)
    setPending(false)
    setOpen(true)
    const digests = await digestFiles(first.hashCandidates)
    if (current !== generation.current) return
    lastInput.current = { ...base, digests }
    setPlan(buildFolderUploadPlan(lastInput.current))
  }, [screeningProjectId])

  const probe = useCallback(async (files: readonly File[], current: number): Promise<void> => {
    const unasked = files.filter((file) => !probed.current.has(file.name))
    if (unasked.length === 0) return
    const [found, offers] = await Promise.all([
      documentsFor(lastSource.current, unasked),
      offersFor(lastOfferSource.current, unasked, lastInput.current ? buildFolderUploadPlan(lastInput.current).files : []),
    ])
    if (current !== generation.current || !lastInput.current) return
    for (const file of unasked) probed.current.add(file.name)
    lastInput.current = withOffers(withDocuments(lastInput.current, found), offers)
    setPlan(buildFolderUploadPlan(lastInput.current))
    const asked = lastInput.current
    const unread = buildFolderUploadPlan(asked).hashCandidates.filter((candidate) => !asked.digests?.has(candidate))
    const read = await digestFiles(unread)
    if (current !== generation.current || !lastInput.current) return
    const latest = lastInput.current
    lastInput.current = { ...latest, digests: new Map([...(latest.digests ?? []), ...read]) }
    setPlan(buildFolderUploadPlan(lastInput.current))
  }, [])

  const setReleased = useCallback<UploadDecision['setReleased']>(
    async (file, released) => {
      const input = lastInput.current
      if (!input?.screening) return
      const next = new Set(input.screening.released)
      if (released) next.add(file)
      else next.delete(file)
      lastInput.current = { ...input, screening: { ...input.screening, released: next } }
      setPlan(buildFolderUploadPlan(lastInput.current))
      if (!released || probed.current.has(file.name)) return
      const current = generation.current
      const answer = probe([file], current).catch((error: unknown) => {
        const latest = lastInput.current
        if (current === generation.current && latest?.screening) {
          const kept = new Set(latest.screening.released)
          kept.delete(file)
          lastInput.current = { ...latest, screening: { ...latest.screening, released: kept } }
          setPlan(buildFolderUploadPlan(lastInput.current))
        }
        throw error
      })
      const tracked = answer.then(
        () => undefined,
        () => undefined
      )
      asking.current.add(tracked)
      void tracked.then(() => asking.current.delete(tracked))
      await answer
    },
    [probe]
  )

  const changeRevision = useCallback<UploadDecision['changeRevision']>(({ files, chosen, targetId }) => {
    const input = lastInput.current
    if (!input) return
    const choices = new Map(input.revisionChoices ?? [])
    for (const file of files) {
      choices.set(file, { ...choices.get(file), ...(targetId ? { targetId, chosen: chosen ?? true } : { chosen }) })
    }
    lastInput.current = { ...input, revisionChoices: choices }
    setPlan(buildFolderUploadPlan(lastInput.current))
  }, [])

  const settle = useCallback<UploadDecision['settle']>(async () => {
    const current = generation.current
    while (asking.current.size > 0) await Promise.all([...asking.current])
    const policy = await loadUploadScreeningPolicy(screeningProjectId)
    const input = lastInput.current
    if (current !== generation.current || !input?.screening) return null
    lastInput.current = { ...input, screening: { ...input.screening, policy } }
    const admitted = buildFolderUploadPlan(lastInput.current)
      .files.filter((file) => file.action !== 'excluded')
      .map((file) => file.file)
    await probe(admitted, current)
    if (current !== generation.current || !lastInput.current) return null
    const settled = buildFolderUploadPlan(lastInput.current)
    setPlan(settled)
    return { plan: settled, policy }
  }, [probe, screeningProjectId])

  return { propose, setReleased, settle, changeRevision, plan, kind, open, setOpen, pending, setPending }
}
