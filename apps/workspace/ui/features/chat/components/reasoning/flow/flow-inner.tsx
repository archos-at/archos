import { type FC, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useSlideBelow } from '@/components/motion/slide-below'
import { cn } from '@/lib/utils'
import { EDGE_STROKE, type FlowNode, type HandleSpec } from './flow-node-data'
import { nodeTypes } from './flow-nodes'
import { ROW_GAP, PAD, SHEET_EDGE, FanLayout } from './flow-layout'
import { stepPath, type FlowEdge, type FlowPoint } from './flow-edges'
import { BuiltGraph, animateFrontier, keepEdgeIdentity } from './build-graph'

const MIN_HEIGHT = 120

const ARRIVING = 'animate-in fade-in-0 duration-base motion-reduce:animate-none'

type Box = { left: number; top: number; width: number; height: number }

const handleLeft = (node: FlowNode, handleId: string): string => {
  const data = node.data as { sources?: HandleSpec[]; targets?: HandleSpec[]; source?: HandleSpec }
  const specs = [...(data.sources ?? []), ...(data.targets ?? []), ...(data.source ? [data.source] : [])]
  return specs.find((spec) => spec.id === handleId)?.left ?? '50%'
}

const along = (left: string, width: number): number =>
  left.endsWith('%') ? (width * Number.parseFloat(left)) / 100 : Number.parseFloat(left) || 0

export function edgeEnds(
  edge: FlowEdge,
  nodes: ReadonlyMap<string, FlowNode>,
  boxes: ReadonlyMap<string, Box>
): { from: FlowPoint; to: FlowPoint } | null {
  const source = nodes.get(edge.source)
  const target = nodes.get(edge.target)
  const from = boxes.get(edge.source)
  const to = boxes.get(edge.target)
  if (!source || !target || !from || !to) return null
  const inTop =
    target.type === 'sourceColumn' && edge.targetHandle === 'in'
      ? ((target.data as { inTop?: number }).inTop ?? 0)
      : 0
  return {
    from: { x: from.left + along(handleLeft(source, edge.sourceHandle), from.width), y: from.top + from.height },
    to: { x: to.left + along(handleLeft(target, edge.targetHandle), to.width), y: to.top + inTop },
  }
}

const measureBoxes = (rows: HTMLElement): Map<string, Box> => {
  const boxes = new Map<string, Box>()
  rows.querySelectorAll<HTMLElement>('[data-flow-node]').forEach((element) => {
    const row = element.parentElement
    if (!element.dataset.id || !row) return
    boxes.set(element.dataset.id, {
      left: row.offsetLeft + element.offsetLeft,
      top: row.offsetTop + element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    })
  })
  return boxes
}

export const FlowInner: FC<{ built: BuiltGraph; layout: FanLayout; live: boolean }> = ({
  built,
  layout,
  live,
}) => {
  const t = useTranslations(chatCopy)
  const { nodes, edges, rows } = built
  const rowsRef = useRef<HTMLDivElement>(null)

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const rowOf = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((row, i) => row.forEach((id) => map.set(id, i)))
    return map
  }, [rows])

  const frontierKey = live ? (rows.at(-1) ?? []).join('|') : ''
  const keptEdgesRef = useRef<FlowEdge[]>([])
  const renderedEdges = useMemo(() => {
    const newestRow = frontierKey ? frontierKey.split('|') : []
    const kept = keepEdgeIdentity(keptEdgesRef.current, animateFrontier(edges, newestRow))
    keptEdgesRef.current = kept
    return kept
  }, [edges, frontierKey])

  const seen = useRef<{ rows: Set<string>; nodes: Set<string> } | null>(null)
  const previouslySeen = seen.current
  const arrives = (id: string, kind: 'rows' | 'nodes') =>
    live && previouslySeen !== null && !previouslySeen[kind].has(id)
  useLayoutEffect(() => {
    seen.current = { rows: new Set(rows.map((row) => row[0] ?? '')), nodes: new Set(nodeById.keys()) }
  })

  const [paths, setPaths] = useState<ReadonlyMap<string, { d: string; animated: boolean }>>(
    () => new Map()
  )
  const drawEdges = () => {
    const list = rowsRef.current
    if (!list) return
    const boxes = measureBoxes(list)
    const origins = [...list.children].map((row) => ({
      x: (row as HTMLElement).offsetLeft,
      y: (row as HTMLElement).offsetTop,
    }))
    const next = new Map<string, { d: string; animated: boolean }>()
    for (const edge of renderedEdges) {
      const ends = edgeEnds(edge, nodeById, boxes)
      const row = rowOf.get(edge.target)
      if (!ends || row === undefined) continue
      const origin = origins[row] ?? { x: 0, y: 0 }
      const shift = (p: FlowPoint) => ({ x: p.x - origin.x, y: p.y - origin.y })
      next.set(edge.id, { d: stepPath(shift(ends.from), shift(ends.to), edge.type), animated: Boolean(edge.animated) })
    }
    setPaths((previous) => {
      if (previous.size === next.size && [...next].every(([id, p]) => previous.get(id)?.d === p.d && previous.get(id)?.animated === p.animated)) {
        return previous
      }
      return next
    })
  }
  const drawRef = useRef(drawEdges)
  useLayoutEffect(() => {
    drawRef.current = drawEdges
    drawEdges()
  })
  useLayoutEffect(() => {
    const list = rowsRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => drawRef.current())
    observer.observe(list)
    list.querySelectorAll('[data-flow-node]').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [nodes])

  const tallest = useRef(0)
  useLayoutEffect(() => {
    const list = rowsRef.current
    if (!list) return
    list.style.minHeight = ''
    if (!live) {
      tallest.current = 0
      return
    }
    tallest.current = Math.max(tallest.current, list.offsetHeight)
    list.style.minHeight = `${tallest.current}px`
  })

  useSlideBelow(rowsRef)

  return (
    <div
      style={{
        ['--banner-w' as string]: `${layout.contentW}px`,
        ['--source-w' as string]: `${layout.colW}px`,
        minHeight: MIN_HEIGHT,
      }}
      className="w-full"
      data-testid="reasoning-flow"
      role="group"
      aria-label={t('thinking.reasoningGraphLabel')}
    >
      <div
        ref={rowsRef}
        className="relative flex flex-col"
        style={{
          gap: ROW_GAP,
          padding: `${SHEET_EDGE}px ${SHEET_EDGE}px ${PAD}px`,
          boxSizing: 'border-box',
        }}
      >
        {rows.map((row, i) => {
          const key = row[0] ?? `row-${i}`
          return (
            <div
              key={key}
              data-flow-row
              className={cn('relative grid', arrives(key, 'rows') && ARRIVING)}
              style={{ zIndex: rows.length - i }}
            >
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 overflow-visible"
                width={1}
                height={1}
              >
                {renderedEdges
                  .filter((edge) => rowOf.get(edge.target) === i)
                  .map((edge) => {
                    const path = paths.get(edge.id)
                    return path ? (
                      <path
                        key={edge.id}
                        d={path.d}
                        fill="none"
                        stroke={EDGE_STROKE}
                        strokeWidth={1.5}
                        className={path.animated ? 'reasoning-flow-edge-live' : undefined}
                      />
                    ) : null
                  })}
              </svg>
              {row.map((id) => {
                const node = nodeById.get(id)
                if (!node) return null
                const Node = nodeTypes[node.type] as FC<{ data: unknown }>
                return (
                  <div
                    key={id}
                    data-id={id}
                    data-flow-node
                    className={cn(
                      'relative col-start-1 row-start-1 max-w-full self-start justify-self-start',
                      !arrives(key, 'rows') && arrives(id, 'nodes') && ARRIVING
                    )}
                    style={{ marginLeft: node.position.x }}
                  >
                    <Node data={node.data} />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
