import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'

import type { PageRegion } from '../lib/page-region'
import { clampZoom } from '../lib/pdf-zoom'

const REGION_FILL = 0.3

export function regionZoom(options: {
  box: PageRegion['box']
  page: { width: number; height: number }
  frame: { width: number; height: number }
  zoom: number
  maxZoom: number
}): number {
  const { box, page, frame, zoom, maxZoom } = options
  const wide = Math.max((box[2] - box[0]) * page.width, 1)
  const tall = Math.max((box[3] - box[1]) * page.height, 1)
  const grow = Math.min((REGION_FILL * frame.width) / wide, (REGION_FILL * frame.height) / tall)
  return clampZoom(Math.max(zoom, zoom * grow), maxZoom)
}

export function unionBox(regions: readonly PageRegion[]): PageRegion['box'] {
  return [
    Math.min(...regions.map((region) => region.box[0])),
    Math.min(...regions.map((region) => region.box[1])),
    Math.max(...regions.map((region) => region.box[2])),
    Math.max(...regions.map((region) => region.box[3])),
  ]
}

const SETTLE_FRAMES = 3
const MAX_FRAMES = 60

function centreOn(frameNode: HTMLElement, pageNode: HTMLElement, box: PageRegion['box']): void {
  const frame = frameNode.getBoundingClientRect()
  const sheet = pageNode.getBoundingClientRect()
  const x = sheet.left - frame.left + frameNode.scrollLeft + ((box[0] + box[2]) / 2) * sheet.width
  const y = sheet.top - frame.top + frameNode.scrollTop + ((box[1] + box[3]) / 2) * sheet.height
  frameNode.scrollTo({
    left: Math.max(0, x - frameNode.clientWidth / 2),
    top: Math.max(0, y - frameNode.clientHeight / 2),
  })
}

export function usePdfRegionFrame(args: {
  enabled: boolean
  ready: boolean
  page: number | null | undefined
  regionsOnPage: readonly PageRegion[] | null
  scrollRef: RefObject<HTMLDivElement | null>
  pageRefs: RefObject<Map<number, HTMLDivElement>>
  zoomRef: RefObject<number>
  maxZoomRef: RefObject<number>
  setZoom: Dispatch<SetStateAction<number>>
  setPing: Dispatch<SetStateAction<number>>
}): void {
  const framed = useRef(false)
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const { enabled, ready, page, regionsOnPage } = args
  useEffect(() => {
    if (!enabled || framed.current || !ready || !page || !regionsOnPage) return
    const frameNode = args.scrollRef.current
    const pageNode = args.pageRefs.current.get(page)
    if (!frameNode || !pageNode || pageNode.offsetWidth <= 0 || frameNode.clientWidth <= 0) return
    framed.current = true
    const box = unionBox(regionsOnPage)
    const target = regionZoom({
      box,
      page: { width: pageNode.offsetWidth, height: pageNode.offsetHeight },
      frame: { width: frameNode.clientWidth, height: frameNode.clientHeight },
      zoom: args.zoomRef.current,
      maxZoom: args.maxZoomRef.current,
    })
    args.zoomRef.current = target
    args.setZoom(target)
    let frames = 0
    let still = 0
    let width = -1
    const settle = (): void => {
      const node = args.pageRefs.current.get(page)
      if (!node) return
      centreOn(frameNode, node, box)
      still = node.offsetWidth === width ? still + 1 : 0
      width = node.offsetWidth
      frames += 1
      if (still >= SETTLE_FRAMES || frames >= MAX_FRAMES) args.setPing((previous) => previous + 1)
      else raf.current = requestAnimationFrame(settle)
    }
    raf.current = requestAnimationFrame(settle)
  })
}
