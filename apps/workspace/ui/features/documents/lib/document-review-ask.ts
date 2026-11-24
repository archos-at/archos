import type { CanvasAsk } from '../hooks/use-canvas-ask'

export const documentReviewOf = (asks: readonly CanvasAsk[]): CanvasAsk | null =>
  asks.findLast((ask) => ask.region === null && !ask.replyInThread) ?? null
