'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShelfLive } from '@/features/realtime/use-shelf-live'
import type { BimProfileSuggestion } from '@/lib/bim/profile'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import {
  attachConfirmations,
  type BimCheckConfirmation,
  type BimComplianceChange,
  type BimComplianceSummary,
  type BimRuleResult,
  type BimRuleResultWithConfirmation,
} from '@/lib/bim/rules'
import type { BimQuantityRow, BimRoomSchedule } from '@/lib/bim/schedule'
import { BIM_ELEMENTS_PAGE_LIMIT, type BimModelSummary } from '@/lib/bim/types'
import type { BimHighlightGroup, BimHighlightStatus, BimViewerElement } from '../lib/model-index'

export interface BimModelHeaderView {
  id: string
  documentId: string
  projectId: string | null
  filename: string
  displayName: string | null
  status: 'pending' | 'extracting' | 'ready' | 'failed'
  schemaVersion: string | null
  elementCount: number
  errorMessage: string | null
  summary: BimModelSummary | null
  updatedAt: string
}

interface AsyncState<T> {
  data: T | null
  isLoading: boolean
  error: string | null
}

const IDLE = { data: null, isLoading: false, error: null } as const

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${response.status}`)
  return (await response.json()) as T
}

const EXTRACTION_POLL_MS = 4_000
export const EXTRACTION_FALLBACK_POLL_MS = 60_000

const modelsInFlight = new Map<string, Promise<{ models: BimModelHeaderView[] }>>()

function fetchProjectModels(projectId: string): Promise<{ models: BimModelHeaderView[] }> {
  const existing = modelsInFlight.get(projectId)
  if (existing) return existing
  const request = getJson<{ models: BimModelHeaderView[] }>(
    `/api/projects/${projectId}/bim/models`
  ).finally(() => {
    modelsInFlight.delete(projectId)
  })
  modelsInFlight.set(projectId, request)
  return request
}

export function useProjectBimModels(projectId: string | null): AsyncState<BimModelHeaderView[]> & {
  reload: () => void
} {
  const [state, setState] = useState<AsyncState<BimModelHeaderView[]>>(IDLE)
  const [tick, setTick] = useState(0)
  const shownFor = useRef<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    if (!projectId) {
      shownFor.current = null
      setState(IDLE)
      setExtracting(false)
      return
    }
    let cancelled = false
    if (shownFor.current !== projectId) setExtracting(false)
    const carryOver = shownFor.current === projectId
    shownFor.current = projectId
    setState((previous) => ({
      data: carryOver ? previous.data : null,
      isLoading: true,
      error: null,
    }))
    fetchProjectModels(projectId)
      .then((body) => {
        if (cancelled) return
        setState({ data: body.models, isLoading: false, error: null })
        setExtracting(
          body.models.some((model) => model.status === 'pending' || model.status === 'extracting')
        )
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const shelf = useMemo<LiveShelf | null>(() => (projectId ? { kind: 'project', projectId } : null), [projectId])
  useShelfLive(shelf, reload, { enabled: extracting })
  useEffect(() => {
    if (!extracting) return
    const timer = setInterval(reload, EXTRACTION_FALLBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [extracting, reload])

  return { ...state, reload }
}

const documentModelInFlight = new Map<string, Promise<{ model: BimModelHeaderView | null }>>()

function fetchDocumentModel(documentId: string): Promise<{ model: BimModelHeaderView | null }> {
  const existing = documentModelInFlight.get(documentId)
  if (existing) return existing
  const request = getJson<{ model: BimModelHeaderView | null }>(
    `/api/documents/${documentId}/model`
  ).finally(() => {
    documentModelInFlight.delete(documentId)
  })
  documentModelInFlight.set(documentId, request)
  return request
}

export function useDocumentBimModel(documentId: string | null): AsyncState<BimModelHeaderView | null> & {
  reload: () => void
} {
  const [state, setState] = useState<AsyncState<BimModelHeaderView | null>>(IDLE)
  const [tick, setTick] = useState(0)
  const shownFor = useRef<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    if (!documentId) {
      shownFor.current = null
      setState(IDLE)
      setExtracting(false)
      return
    }
    let cancelled = false
    if (shownFor.current !== documentId) setExtracting(false)
    const carryOver = shownFor.current === documentId
    shownFor.current = documentId
    setState((previous) => ({
      data: carryOver ? previous.data : null,
      isLoading: true,
      error: null,
    }))
    fetchDocumentModel(documentId)
      .then((body) => {
        if (cancelled) return
        setState({ data: body.model, isLoading: false, error: null })
        setExtracting(body.model?.status === 'pending' || body.model?.status === 'extracting')
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [documentId, tick])

  useEffect(() => {
    if (!extracting) return
    const timer = setInterval(() => setTick((value) => value + 1), EXTRACTION_POLL_MS)
    return () => clearInterval(timer)
  }, [extracting])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}

export async function walkBimElements(
  modelId: string,
  filter: Record<string, unknown>,
  signal: AbortSignal
): Promise<BimViewerElement[]> {
  const PAGE = BIM_ELEMENTS_PAGE_LIMIT
  const CONCURRENCY = 6

  const fetchPage = (offset: number) =>
    getJson<{ elements: BimViewerElement[]; total?: number; totalIsLowerBound?: boolean }>(
      `/api/bim/models/${modelId}/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'elements', filter, limit: PAGE, offset }),
        signal,
      }
    )

  const first = await fetchPage(0)
  const collected = [...first.elements]
  if (first.elements.length < PAGE) return collected

  const known =
    typeof first.total === 'number' && first.totalIsLowerBound !== true
      ? Math.ceil(first.total / PAGE)
      : Infinity

  let offset = PAGE
  let done = false
  for (let round = 0; round < 80 && !done; round += 1) {
    const width = Math.min(CONCURRENCY, Math.max(1, known - offset / PAGE))
    if (width <= 0) break
    const offsets = Array.from({ length: width }, (_, index) => offset + index * PAGE)
    const pages = await Promise.all(offsets.map(fetchPage))
    for (const page of pages) {
      collected.push(...page.elements)
      if (page.elements.length < PAGE) done = true
    }
    offset += width * PAGE
    if (offset / PAGE >= known) done = true
  }
  return collected
}

export function useBimElements(
  modelId: string | null
): AsyncState<BimViewerElement[]> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<BimViewerElement[]>>(IDLE)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!modelId) {
      setState(IDLE)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setState({ data: null, isLoading: true, error: null })

    walkBimElements(modelId, {}, controller.signal)
      .then((elements) => {
        if (!cancelled) setState({ data: elements, isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [modelId, tick])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}

export interface BimHighlightSpec {
  globalIds?: string[]
  match?: Record<string, unknown>
  label: string
  status: BimHighlightStatus
}

export function useBimHighlightGroups(
  modelId: string | null,
  specs: readonly BimHighlightSpec[]
): AsyncState<BimHighlightGroup[]> {
  const [resolved, setResolved] = useState<AsyncState<BimHighlightGroup[]>>(IDLE)
  const key = JSON.stringify(specs)

  useEffect(() => {
    const groups: BimHighlightSpec[] = JSON.parse(key)
    const literal = groups.map((group) => ({
      globalIds: group.globalIds ?? [],
      label: group.label,
      status: group.status,
    }))
    if (!modelId || !groups.some((group) => group.match)) {
      setResolved({ data: literal, isLoading: false, error: null })
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setResolved({ data: null, isLoading: true, error: null })

    const run = async (): Promise<{ next: BimHighlightGroup[]; failed: boolean }> => {
      const next: BimHighlightGroup[] = []
      let failed = false
      for (const [index, group] of groups.entries()) {
        if (!group.match) {
          next.push(literal[index])
          continue
        }
        try {
          const elements = await walkBimElements(modelId, group.match, controller.signal)
          next.push({
            globalIds: elements.map((element) => element.globalId),
            label: group.label,
            status: group.status,
          })
        } catch {
          failed = true
          next.push(literal[index])
        }
      }
      return { next, failed }
    }

    run().then(({ next, failed }) => {
      if (!cancelled) setResolved({ data: next, isLoading: false, error: failed ? 'load-failed' : null })
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [modelId, key])

  return resolved
}

export interface BimElementDetail {
  globalId: string
  expressId: number
  ifcType: string
  name: string | null
  description: string | null
  predefinedType: string | null
  objectType: string | null
  tag: string | null
  typeName: string | null
  storeyName: string | null
  materials: string[]
  classifications: Array<{ system: string | null; identification: string | null; name: string | null }>
  properties: Record<string, Record<string, string | number | boolean | null>>
  quantities: Record<string, Record<string, number>>
}

export function useBimElementDetail(
  modelId: string | null,
  globalId: string | null
): AsyncState<BimElementDetail> {
  const [state, setState] = useState<AsyncState<BimElementDetail>>(IDLE)

  useEffect(() => {
    if (!modelId || !globalId) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })
    getJson<{ element: BimElementDetail | null }>(`/api/bim/models/${modelId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'element', globalId }),
    })
      .then((body) => {
        if (!cancelled) setState({ data: body.element, isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [modelId, globalId])

  return state
}

export function useBimModelSource(
  modelId: string | null,
  enabled: boolean
): AsyncState<string> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<string>>(IDLE)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!modelId || !enabled) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })
    getJson<{ url: string }>(`/api/bim/models/${modelId}/source`)
      .then((body) => {
        if (!cancelled) setState({ data: body.url, isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
  }, [modelId, enabled, tick])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}

function useModelQuery<T>(
  modelId: string | null,
  request: Record<string, unknown> | null,
  select: (body: BimQueryResponse) => T | null
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>(IDLE)
  const [tick, setTick] = useState(0)
  const body = request ? JSON.stringify(request) : null

  useEffect(() => {
    if (!modelId || !body) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })
    getJson<BimQueryResponse>(`/api/bim/models/${modelId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then((payload) => {
        if (!cancelled) setState({ data: select(payload), isLoading: false, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: 'load-failed' })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, body, tick])

  return { ...state, reload: useCallback(() => setTick((value) => value + 1), []) }
}

interface BimQueryResponse {
  summary?: string
  caveat?: string | null
  truncated?: boolean
  compliance?: BimRuleResult[]
  complianceSummary?: BimComplianceSummary
  complianceShoppingList?: Array<{ path: string; elements: number; rules: string[] }>
  schedule?: BimRoomSchedule
  takeoff?: BimQuantityRow[]
  profileSuggestions?: BimProfileSuggestion[]
}

const SCHEDULE_REQUEST = { op: 'schedule' } as const
const PROFILE_REQUEST = { op: 'profile' } as const

const selectSchedule = (
  body: BimQueryResponse
): { schedule: BimRoomSchedule; truncated: boolean } | null =>
  body.schedule ? { schedule: body.schedule, truncated: body.truncated ?? false } : null
const selectTakeoff = (
  body: BimQueryResponse
): { rows: BimQuantityRow[]; truncated: boolean } | null =>
  body.takeoff ? { rows: body.takeoff, truncated: body.truncated ?? false } : null
const selectProfile = (body: BimQueryResponse): BimProfileSuggestion[] | null =>
  body.profileSuggestions ?? null

export function useBimRoomSchedule(
  modelId: string | null
): AsyncState<{ schedule: BimRoomSchedule; truncated: boolean }> & { reload: () => void } {
  return useModelQuery(modelId, SCHEDULE_REQUEST, selectSchedule)
}

export function useBimTakeoff(
  modelId: string | null,
  quantity: string,
  byMaterial: boolean
): AsyncState<{ rows: BimQuantityRow[]; truncated: boolean }> & { reload: () => void } {
  const request = useMemo(
    () => ({ op: 'takeoff' as const, quantity, byMaterial }),
    [quantity, byMaterial]
  )
  return useModelQuery(modelId, request, selectTakeoff)
}

export function useBimProfileSuggestions(
  modelId: string | null
): AsyncState<BimProfileSuggestion[]> & { reload: () => void } {
  return useModelQuery(modelId, PROFILE_REQUEST, selectProfile)
}

interface BimComplianceView {
  rules: BimRuleResultWithConfirmation[]
  summary: BimComplianceSummary | null
  shoppingList: Array<{ path: string; elements: number; rules: string[] }>
  truncated: boolean
}

const selectCompliance = (body: BimQueryResponse): BimComplianceView | null =>
  body.compliance
    ? {
        rules: body.compliance.map((rule) => ({
          ...rule,
          confirmation: null,
          confirmationStale: false,
        })),
        summary: body.complianceSummary ?? null,
        shoppingList: body.complianceShoppingList ?? [],
        truncated: body.truncated === true,
      }
    : null

export function useBimCompliance(
  projectId: string | null,
  modelId: string | null,
  facts: { buildingClass: number | null; mainUse: string | null; ready?: boolean },
  seriesModelIds: readonly string[] = []
): AsyncState<BimComplianceView> & {
  confirm: (ruleId: string, note: string) => Promise<void>
  withdraw: (ruleId: string) => Promise<void>
  reload: () => void
  confirmationsFailed: boolean
} {
  const request = useMemo(
    () => ({
      op: 'compliance' as const,
      ...(facts.buildingClass === null ? {} : { buildingClass: facts.buildingClass }),
      ...(facts.mainUse === null ? {} : { mainUse: facts.mainUse }),
    }),
    [facts.buildingClass, facts.mainUse]
  )
  const run = useModelQuery(facts.ready === false ? null : modelId, request, selectCompliance)
  const [confirmations, setConfirmations] = useState<BimCheckConfirmation[]>([])
  const [confirmationsFailed, setConfirmationsFailed] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setConfirmationsFailed(false)
    getJson<{ confirmations: BimCheckConfirmation[] }>(`/api/projects/${projectId}/bim/checks`)
      .then((body) => {
        if (!cancelled) setConfirmations(body.confirmations)
      })
      .catch(() => {
        if (cancelled) return
        setConfirmations([])
        setConfirmationsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const write = useCallback(
    async (method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
      if (!projectId) return
      await getJson(`/api/projects/${projectId}/bim/checks`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setTick((value) => value + 1)
    },
    [projectId]
  )

  const data = useMemo(() => {
    if (!run.data || !modelId) return run.data
    return {
      ...run.data,
      rules: attachConfirmations(run.data.rules, confirmations, modelId, [
        ...seriesModelIds,
        modelId,
      ]),
    }
  }, [run.data, confirmations, modelId, seriesModelIds])

  return {
    ...run,
    data,
    confirmationsFailed,
    confirm: useCallback(
      (ruleId: string, note: string) =>
        write('POST', { ruleId, modelId, note: note === '' ? null : note }),
      [write, modelId]
    ),
    withdraw: useCallback(
      (ruleId: string) => write('DELETE', { ruleId, modelId }),
      [write, modelId]
    ),
  }
}

export function useBimComplianceDiff(
  modelId: string | null,
  baseModelId: string | null,
  facts: { buildingClass: number | null; mainUse: string | null }
): AsyncState<{ changes: BimComplianceChange[]; truncated: boolean }> & { run: () => void } {
  const [state, setState] = useState<
    AsyncState<{ changes: BimComplianceChange[]; truncated: boolean }>
  >(IDLE)

  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    setState(IDLE)
  }, [modelId, baseModelId, facts.buildingClass, facts.mainUse])

  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )

  const run = useCallback(() => {
    if (!modelId || !baseModelId) return
    generation.current += 1
    const ticket = generation.current
    setState({ data: null, isLoading: true, error: null })
    getJson<{ complianceChanges?: BimComplianceChange[]; truncated?: boolean }>(
      `/api/bim/models/${modelId}/query`,
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'compliance-diff',
        baseModelId,
        ...(facts.buildingClass === null ? {} : { buildingClass: facts.buildingClass }),
        ...(facts.mainUse === null ? {} : { mainUse: facts.mainUse }),
      }),
    })
      .then((body) => {
        if (generation.current !== ticket) return
        setState({
          data: { changes: body.complianceChanges ?? [], truncated: body.truncated ?? false },
          isLoading: false,
          error: null,
        })
      })
      .catch(() => {
        if (generation.current !== ticket) return
        setState({ data: null, isLoading: false, error: 'load-failed' })
      })
  }, [modelId, baseModelId, facts.buildingClass, facts.mainUse])

  return { ...state, run }
}

export type BimRuleFactKey = 'buildingClass' | 'mainUse'

export function useProjectRuleFacts(projectId: string | null): {
  buildingClass: number | null
  mainUse: string | null
  missing: BimRuleFactKey[]
  ready: boolean
  failed: boolean
  reload: () => void
} {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [facts, setFacts] = useState<{ buildingClass: number | null; mainUse: string | null }>({
    buildingClass: null,
    mainUse: null,
  })

  useEffect(() => {
    if (!projectId) {
      setReady(true)
      return
    }
    setReady(false)
    setFailed(false)
    setFacts({ buildingClass: null, mainUse: null })
    let cancelled = false
    getJson<{ facts?: Record<string, { value?: unknown }> }>(`/api/projects/${projectId}/profile`)
      .then((profile) => {
        if (cancelled) return
        const raw = profile.facts ?? {}
        const klasse = Number(String(raw.building_class?.value ?? '').trim().replace(/^GK\s*/i, ''))
        const use = raw.main_use?.value
        setFacts({
          buildingClass: Number.isInteger(klasse) && klasse >= 1 && klasse <= 5 ? klasse : null,
          mainUse: typeof use === 'string' && use.trim() !== '' ? use : null,
        })
      })
      .catch(() => {
        if (!cancelled) setFacts({ buildingClass: null, mainUse: null })
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const missing = useMemo(() => {
    if (failed || !ready) return []
    const gaps: BimRuleFactKey[] = []
    if (facts.buildingClass === null) gaps.push('buildingClass')
    if (facts.mainUse === null) gaps.push('mainUse')
    return gaps
  }, [facts, failed, ready])

  return { ...facts, missing, ready, failed, reload: useCallback(() => setTick((v) => v + 1), []) }
}

export function pickDefaultModel(models: readonly BimModelHeaderView[]): BimModelHeaderView | null {
  return models.find((model) => model.status === 'ready') ?? models[0] ?? null
}

export function resolveModelByFilename(
  models: readonly BimModelHeaderView[],
  filename: string | null
): { model: BimModelHeaderView | null; ambiguous: boolean } {
  if (models.length === 0) return { model: null, ambiguous: false }
  if (!filename) return { model: pickDefaultModel(models), ambiguous: false }
  const needle = filename.toLowerCase()
  const exact = models.find((candidate) => candidate.filename.toLowerCase() === needle)
  if (exact) return { model: exact, ambiguous: false }
  const partial = models.filter((candidate) => candidate.filename.toLowerCase().includes(needle))
  if (partial.length === 1) return { model: partial[0] ?? null, ambiguous: false }
  return { model: null, ambiguous: partial.length > 1 }
}

export function notReadyModelStatus(
  models: readonly BimModelHeaderView[],
  filename: string | null
): 'extracting' | 'failed' | null {
  const pending = models.filter((candidate) => candidate.status !== 'ready')
  if (pending.length === 0) return null
  const needle = (filename ?? '').toLowerCase()
  const named = needle
    ? pending.filter((candidate) => candidate.filename.toLowerCase().includes(needle))
    : pending
  if (named.length === 0) return null
  return named.some((candidate) => candidate.status === 'failed') ? 'failed' : 'extracting'
}

export function useElementTypes(elements: readonly BimViewerElement[]): string[] {
  return useMemo(
    () => [...new Set(elements.map((element) => element.ifcType))].sort(),
    [elements]
  )
}
