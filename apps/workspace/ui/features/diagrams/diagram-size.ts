export const FRAME_CHROME_PX = 26

export const MIN_SCALE = 0.75

export function viewBoxWidth(svg: string): number | null {
  const match =
    /<svg\b[^>]*\bviewBox="\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+[\d.e]+\s*"/i.exec(svg)
  if (!match) return null
  const width = Number.parseFloat(match[1])
  return Number.isFinite(width) && width > 0 ? width : null
}

export function diagramFrameStyle(svg: string): { width: string; maxWidth: string } | undefined {
  const width = viewBoxWidth(svg)
  if (width === null) return undefined
  const rounded = Math.ceil(width)
  return {
    width: `${rounded}px`,
    maxWidth: `max(calc(100cqw - ${FRAME_CHROME_PX}px), ${Math.ceil(rounded * MIN_SCALE)}px)`,
  }
}
