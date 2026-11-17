'use client'

import { useEffect, useState } from 'react'

import type { DiagramModel } from './model'
import { parseMermaid } from './parse-mermaid'

const MODEL_CACHE_LIMIT = 64

const settled = new Map<string, DiagramModel | null>()
const inFlight = new Map<string, Promise<DiagramModel | null>>()

function remember(source: string, model: DiagramModel | null): void {
  settled.delete(source)
  settled.set(source, model)
  if (settled.size <= MODEL_CACHE_LIMIT) return
  const oldest = settled.keys().next().value
  if (oldest !== undefined) settled.delete(oldest)
}

function recall(source: string): { model: DiagramModel | null } | null {
  if (!settled.has(source)) return null
  const model = settled.get(source) ?? null
  remember(source, model)
  return { model }
}

function parseOnce(source: string): Promise<DiagramModel | null> {
  const hit = recall(source)
  if (hit) return Promise.resolve(hit.model)
  const pending = inFlight.get(source)
  if (pending) return pending
  const parse = parseMermaid(source)
    .catch(() => null)
    .then((model) => {
      remember(source, model)
      inFlight.delete(source)
      return model
    })
  inFlight.set(source, parse)
  return parse
}

export function clearDiagramModelCache(): void {
  settled.clear()
  inFlight.clear()
}

export function useDiagramModel(source: string, enabled = true): DiagramModel | null | undefined {
  const [state, setState] = useState<{ source: string; model: DiagramModel | null } | null>(() => {
    const hit = enabled ? recall(source) : null
    return hit ? { source, model: hit.model } : null
  })
  const held = state?.source === source ? state : null
  useEffect(() => {
    if (!enabled || held) return
    let cancelled = false
    void parseOnce(source).then((model) => {
      if (!cancelled) setState({ source, model })
    })
    return () => {
      cancelled = true
    }
  }, [source, enabled, held])
  if (held) return held.model
  if (enabled && settled.has(source)) return settled.get(source) ?? null
  return undefined
}
