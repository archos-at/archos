'use client'

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Element, ElementContent, Root, Text } from 'hast'

import { asWebAnimation, motionBase, usePrefersReducedMotion } from '@/components/motion'
import type { MarkdownBlock } from './markdown-blocks'

export interface InkRun {
  from: number
  to: number
  born: number
}

export interface InkState {
  content: string
  runs: readonly InkRun[]
}

export const NO_INK: readonly InkRun[] = []

const INK = asWebAnimation(motionBase)

export const INK_MS = INK.duration as number

const BUCKET_MS = 40

export function nextInk(previous: InkState, content: string, now: number): InkState {
  if (!content.startsWith(previous.content)) return { content, runs: NO_INK }
  const live = previous.runs.filter((run) => now - run.born < INK_MS)
  const from = previous.content.length
  if (content.length === from) return { content, runs: live }
  const last = live.at(-1)
  if (last && last.to === from && now - last.born < BUCKET_MS) {
    return { content, runs: [...live.slice(0, -1), { ...last, to: content.length }] }
  }
  return { content, runs: [...live, { from, to: content.length, born: now }] }
}

export function blockInk(blocks: readonly MarkdownBlock[], content: string, runs: readonly InkRun[]): (readonly InkRun[])[] {
  if (runs.length === 0) return blocks.map(() => NO_INK)
  const lineStarts = [0]
  for (let index = 0; index < content.length; index++) if (content[index] === '\n') lineStarts.push(index + 1)
  return blocks.map((block) => {
    const start = lineStarts[block.line] ?? 0
    const end = start + block.source.length
    const inside = runs
      .filter((run) => run.to > start && run.from < end)
      .map((run) => ({ from: Math.max(0, run.from - start), to: Math.min(end, run.to) - start, born: run.born }))
    return inside.length > 0 ? inside : NO_INK
  })
}

const INKED = new Set([
  'p', 'li', 'ul', 'ol', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'b', 'i', 'del', 's', 'u', 'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
])

const inkSpan = (value: string, born: number): Element => ({
  type: 'element',
  tagName: 'span',
  properties: { dataInk: String(born) },
  children: [{ type: 'text', value }],
})

function inkText(node: Text, runs: readonly InkRun[]): ElementContent[] {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return [node]
  const exact = end - start === node.value.length
  const pieces: ElementContent[] = []
  let at = 0
  for (const run of runs) {
    if (run.to <= start || run.from >= end) continue
    if (!exact) return run.from <= start ? [inkSpan(node.value, run.born)] : [node]
    const from = Math.max(run.from - start, at)
    const to = Math.min(run.to - start, node.value.length)
    if (to <= from) continue
    if (from > at) pieces.push({ type: 'text', value: node.value.slice(at, from) })
    pieces.push(inkSpan(node.value.slice(from, to), run.born))
    at = to
  }
  if (pieces.length === 0) return [node]
  if (at < node.value.length) pieces.push({ type: 'text', value: node.value.slice(at) })
  return pieces
}

function inkIn(parent: Root | Element, runs: readonly InkRun[]): void {
  parent.children = (parent.children as ElementContent[]).flatMap((child): ElementContent[] => {
    if (child.type === 'text') return inkText(child, runs)
    if (child.type === 'element' && INKED.has(child.tagName)) inkIn(child, runs)
    return [child]
  }) as typeof parent.children
}

export const rehypeInk = (options: { runs: readonly InkRun[] }) => (tree: Root): void => {
  if (options.runs.length > 0) inkIn(tree, options.runs)
}

const INK_BY_DEFAULT = process.env.NODE_ENV !== 'test'

export function useInk(content: string, enabled: boolean): readonly InkRun[] {
  const reduced = usePrefersReducedMotion()
  const on = enabled && INK_BY_DEFAULT && !reduced
  const [ink, setInk] = useState<InkState>(() => ({ content, runs: NO_INK }))
  if (ink.content !== content) {
    const kept = content.startsWith(ink.content) ? ink.runs : NO_INK
    setInk(on ? nextInk(ink, content, performance.now()) : { content, runs: kept })
  }
  return reduced ? NO_INK : ink.runs
}

const playing = new WeakMap<HTMLElement, { born: number; animation: Animation }>()

export function useInkAnimations(root: RefObject<HTMLElement | null>, runs: readonly InkRun[]): void {
  const seen = useRef(false)
  useLayoutEffect(() => {
    if (runs.length === 0 && !seen.current) return
    seen.current = true
    const now = performance.now()
    for (const span of root.current?.querySelectorAll<HTMLElement>('[data-ink]') ?? []) {
      const born = Number(span.dataset.ink)
      const current = playing.get(span)
      if (current?.born === born) continue
      current?.animation.cancel()
      const age = now - born
      if (age >= INK_MS || typeof span.animate !== 'function') continue
      playing.set(span, { born, animation: span.animate([{ opacity: 0 }, { opacity: 1 }], { ...INK, delay: -age, fill: 'backwards' }) })
    }
  })
}
