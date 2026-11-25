import { ROW_GAP } from './flow-layout'

export interface FlowEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  type: 'split' | 'merge'
  animated?: boolean
}

export interface FlowPoint {
  x: number
  y: number
}

const EDGE_RADIUS = 12

const TRUNK_ELBOW = ROW_GAP / 2

export function stepPath(from: FlowPoint, to: FlowPoint, type: FlowEdge['type']): string {
  const turnY = type === 'split' ? from.y + TRUNK_ELBOW : to.y - TRUNK_ELBOW
  const dx = to.x - from.x
  if (Math.abs(dx) < 0.5) return `M ${from.x},${from.y} L ${to.x},${to.y}`
  const dir = Math.sign(dx)
  const r = Math.max(0, Math.min(EDGE_RADIUS, Math.abs(dx) / 2, turnY - from.y, to.y - turnY))
  return [
    `M ${from.x},${from.y}`,
    `L ${from.x},${turnY - r}`,
    `Q ${from.x},${turnY} ${from.x + dir * r},${turnY}`,
    `L ${to.x - dir * r},${turnY}`,
    `Q ${to.x},${turnY} ${to.x},${turnY + r}`,
    `L ${to.x},${to.y}`,
  ].join(' ')
}

export function edge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  type: FlowEdge['type'] = 'merge'
): FlowEdge {
  return {
    id: `${source}:${sourceHandle}->${target}:${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    type,
  }
}
