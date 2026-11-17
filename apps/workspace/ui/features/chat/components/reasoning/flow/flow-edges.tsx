import { type FC } from 'react'
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react'
import { EDGE_STROKE } from './flow-node-data'
import { ROW_GAP } from './flow-layout'

const EDGE_RADIUS = 12

const TRUNK_ELBOW = ROW_GAP / 2

function trunkEdge(anchor: 'source' | 'target'): FC<EdgeProps> {
  const TrunkEdge: FC<EdgeProps> = ({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    markerEnd,
    style,
  }) => {
    const [path] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: EDGE_RADIUS,
      centerY: anchor === 'source' ? sourceY + TRUNK_ELBOW : targetY - TRUNK_ELBOW,
      centerX: anchor === 'source' ? sourceX : targetX,
      offset: TRUNK_ELBOW / 2,
    })
    return <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={0} />
  }
  TrunkEdge.displayName = anchor === 'source' ? 'SplitEdge' : 'MergeEdge'
  return TrunkEdge
}

export const edgeTypes = {
  split: trunkEdge('source'),
  merge: trunkEdge('target'),
}

export function edge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  type: 'split' | 'merge' = 'merge'
): Edge {
  return {
    id: `${source}:${sourceHandle}->${target}:${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    type,
    style: { stroke: EDGE_STROKE, strokeWidth: 1.5 },
  }
}
