'use client'

import { createContext, type FC, type ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { DimStatus } from '@/shared/cards/schemas'
import { statusColor } from '../lib/dimension-status'
import { legibleLabelSize } from '../lib/schematic-scale'
import { declutterLabels } from './declutter'

interface SvgLabelProps {
  x: number
  y: number
  children: ReactNode
  anchor?: 'start' | 'middle' | 'end'
  fill?: string
  size?: number
  mono?: boolean
  italic?: boolean
  weight?: number
  transform?: string
  halo?: string
}

const CanvasScale = createContext<number | null>(null)

export const SvgLabel: FC<SvgLabelProps> = ({
  x,
  y,
  children,
  anchor = 'start',
  fill = 'var(--muted-foreground)',
  size = 10,
  mono = false,
  italic = false,
  weight = 500,
  transform,
  halo = 'var(--card)',
}) => {
  const scale = useContext(CanvasScale)
  const drawn = legibleLabelSize(size, scale)
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline="central"
      fontSize={drawn}
      fontWeight={weight}
      fontStyle={italic ? 'italic' : undefined}
      className={mono ? 'font-mono' : 'font-sans'}
      fill={fill}
      stroke={halo}
      strokeWidth={(3 * drawn) / size}
      strokeLinejoin="round"
      transform={transform}
      style={{ paintOrder: 'stroke' }}
    >
      {children}
    </text>
  )
}

interface ExtensionLineProps {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const ExtensionLine: FC<ExtensionLineProps> = ({ x1, y1, x2, y2 }) => (
  <line
    x1={x1}
    y1={y1}
    x2={x2}
    y2={y2}
    stroke="var(--muted-foreground)"
    strokeWidth={0.7}
    opacity={0.55}
  />
)

interface DimensionArrowProps {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  status?: DimStatus | null
  color?: string
  labelOffset?: number
  fontSize?: number
  dashed?: boolean
  horizontalLabel?: boolean
}

export const DimensionArrow: FC<DimensionArrowProps> = ({
  x1,
  y1,
  x2,
  y2,
  label,
  status,
  color,
  labelOffset = -9,
  fontSize = 10,
  dashed,
  horizontalLabel,
}) => {
  const stroke = color ?? (status ? statusColor(status) : 'var(--foreground)')
  const missing = status === 'needs_input'
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const ah = 5.5

  const head = (px: number, py: number, dirX: number, dirY: number): string => {
    const bx = px + dirX * ah
    const by = py + dirY * ah
    const wing = ah * 0.5
    return `M ${bx + nx * wing} ${by + ny * wing} L ${px} ${py} L ${bx - nx * wing} ${by - ny * wing}`
  }

  const mx = (x1 + x2) / 2 + nx * labelOffset
  const my = (y1 + y2) / 2 + ny * labelOffset
  const vertical = Math.abs(ux) < 0.35 && !horizontalLabel
  const transform = vertical ? `rotate(-90 ${mx} ${my})` : undefined

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={1.1}
        strokeDasharray={dashed || missing ? '4 3' : undefined}
      />
      <path
        d={head(x1, y1, ux, uy)}
        stroke={stroke}
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={head(x2, y2, -ux, -uy)}
        stroke={stroke}
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <SvgLabel
        x={mx}
        y={my}
        anchor="middle"
        fill={stroke}
        size={fontSize}
        mono={!missing}
        italic={missing}
        weight={600}
        transform={transform}
      >
        {label}
      </SvgLabel>
    </g>
  )
}

const MAX_CANVAS_SCALE = 1.4

const declutterSvgLabels = (svg: SVGSVGElement, viewW: number): void => {
  const frame = svg.getBoundingClientRect()
  const scale = viewW > 0 ? frame.width / viewW : 0
  const texts = Array.from(svg.querySelectorAll('text'))
  texts.forEach((text) => {
    text.removeAttribute('dx')
    text.removeAttribute('dy')
  })
  if (!(scale > 0)) return
  const live = texts
    .map((text) => ({ text, rect: text.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
  const nudges = declutterLabels(
    live.map(({ text, rect }) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top + rect.height * 0.15,
      bottom: rect.bottom - rect.height * 0.15,
      movable: !text.hasAttribute('transform'),
    })),
    { left: frame.left + 2, right: frame.right - 2 }
  )
  live.forEach(({ text }, index) => {
    const { dx, dy } = nudges[index]
    if (dx !== 0) text.setAttribute('dx', String(dx / scale))
    if (dy !== 0) text.setAttribute('dy', String(dy / scale))
  })
}

interface SchematicCanvasProps {
  viewW: number
  viewH: number
  label: string
  children: ReactNode
}

export const SchematicCanvas: FC<SchematicCanvasProps> = ({ viewW, viewH, label, children }) => {
  const ref = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState<number | null>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const update = () => setScale(svg.getBoundingClientRect().width / viewW)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [viewW])
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    const place = () => declutterSvgLabels(svg, viewW)
    place()
    void document.fonts?.ready.then(place)
  })
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      className="block h-auto w-full"
      style={{ maxWidth: Math.round(viewW * MAX_CANVAS_SCALE) }}
    >
      <CanvasScale.Provider value={scale}>{children}</CanvasScale.Provider>
    </svg>
  )
}
