import { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  applyNodeChanges,
  useNodesInitialized,
  useUpdateNodeInternals,
  type Node,
  type NodeChange,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { HandleSpec } from './flow-node-data'
import { nodeTypes } from './flow-nodes'
import { ROW_GAP, PAD, FanLayout } from './flow-layout'
import { edgeTypes } from './flow-edges'
import { BuiltGraph, sameNodeData, animateFrontier, keepEdgeIdentity } from './build-graph'

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

const PRO_OPTIONS = { hideAttribution: true }

export const FlowInner: FC<{ built: BuiltGraph; layout: FanLayout; live: boolean }> = ({
  built,
  layout,
  live,
}) => {
  const t = useTranslations(chatCopy)
  const { nodes, edges, rows } = built
  const initialized = useNodesInitialized()
  const paneRef = useRef<HTMLDivElement>(null)
  const [rfNodes, setRfNodes] = useState<Node[]>(nodes)
  const [height, setHeight] = useState<number | null>(null)
  const [laidOut, setLaidOut] = useState(false)
  const rowYRef = useRef<number[]>([])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((row, i) => row.forEach((id) => map.set(id, i)))
    return map
  }, [rows])

  useLayoutEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      const next = nodes.map((n) => {
        const old = prevById.get(n.id)
        if (!old) {
          const rowY = rowYRef.current[rowIndexById.get(n.id) ?? -1]
          return { ...n, position: { x: n.position.x, y: rowY ?? rowYRef.current.at(-1) ?? 0 } }
        }
        if (
          old.position.x === n.position.x &&
          old.type === n.type &&
          sameNodeData(old.data, n.data)
        ) {
          return old
        }
        return { ...old, ...n, position: { x: n.position.x, y: old.position.y } }
      })
      const unchanged = next.length === prev.length && next.every((n, i) => n === prev[i])
      return unchanged ? prev : next
    })
  }, [nodes, rowIndexById])

  const updateNodeInternals = useUpdateNodeInternals()
  const handleSigs = useMemo(() => {
    const sigs = new Map<string, string>()
    for (const n of nodes) {
      const d = n.data as {
        sources?: HandleSpec[]
        targets?: HandleSpec[]
        source?: HandleSpec
        inTop?: number
      }
      const specs = [...(d.sources ?? []), ...(d.targets ?? []), ...(d.source ? [d.source] : [])]
      const moved = d.inTop !== undefined ? `;in@${d.inTop}` : ''
      sigs.set(n.id, specs.map((h) => `${h.id}@${h.left}`).join(',') + moved)
    }
    return sigs
  }, [nodes])
  const prevHandleSigs = useRef(handleSigs)
  useEffect(() => {
    const changed: string[] = []
    for (const [id, sig] of handleSigs) {
      const prev = prevHandleSigs.current.get(id)
      if (prev !== undefined && prev !== sig) changed.push(id)
    }
    prevHandleSigs.current = handleSigs
    if (changed.length > 0) updateNodeInternals(changed)
  }, [handleSigs, updateNodeInternals])

  const frontierKey = live ? (rows.at(-1) ?? []).join('|') : ''
  const keptEdgesRef = useRef<Edge[]>([])
  const renderedEdges = useMemo(() => {
    const newestRow = frontierKey ? frontierKey.split('|') : []
    const kept = keepEdgeIdentity(keptEdgesRef.current, animateFrontier(edges, newestRow))
    keptEdgesRef.current = kept
    return kept
  }, [edges, frontierKey])

  const rowsKey = useMemo(() => rows.map((r) => r.join('|')).join('/'), [rows])

  useLayoutEffect(() => {
    if (!initialized) return
    const pane = paneRef.current
    const measured = new Map<string, number>()
    pane?.querySelectorAll<HTMLElement>('.react-flow__node[data-id]').forEach((el) => {
      if (el.dataset.id) measured.set(el.dataset.id, el.offsetHeight)
    })
    const yById = new Map<string, number>()
    const rowY: number[] = []
    let y = 0
    rows.forEach((row, i) => {
      rowY[i] = y
      let rowH = 0
      for (const id of row) {
        yById.set(id, y)
        rowH = Math.max(rowH, measured.get(id) ?? 0)
      }
      y += rowH + ROW_GAP
    })
    rowY[rows.length] = y
    rowYRef.current = rowY

    setRfNodes((prev) => {
      let moved = false
      const next = prev.map((n) => {
        const ny = yById.get(n.id)
        if (ny === undefined || n.position.y === ny) return n
        moved = true
        return { ...n, position: { ...n.position, y: ny } }
      })
      return moved ? next : prev
    })
    const measuredHeight = Math.max(120, Math.ceil(Math.max(0, y - ROW_GAP)) + PAD)
    setHeight((previous) =>
      live && previous !== null ? Math.max(previous, measuredHeight) : measuredHeight
    )
    setLaidOut(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, rowsKey, rfNodes, layout.contentW, layout.colW, live])

  return (
    <div
      ref={paneRef}
      style={{
        height: height ?? undefined,
        minHeight: height ? undefined : 160,
        opacity: laidOut ? 1 : 0,
        ['--banner-w' as string]: `${layout.contentW}px`,
        ['--source-w' as string]: `${layout.colW}px`,
      }}
      className="reasoning-flow-scrollable w-full overflow-hidden"
      data-testid="reasoning-flow"
      role="group"
      aria-label={t('thinking.reasoningGraphLabel')}
    >
      <ReactFlow
        style={height ? { height } : undefined}
        nodes={rfNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        defaultViewport={DEFAULT_VIEWPORT}
        minZoom={1}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={PRO_OPTIONS}
      />
    </div>
  )
}
