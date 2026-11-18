import { countCharacters, type MeasureText } from './passage-highlight'

const MEASURE_SIZE = 100

let context: CanvasRenderingContext2D | null | undefined
let fontSet = ''

const canvasContext = (): CanvasRenderingContext2D | null => {
  if (context !== undefined) return context
  try {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  } catch {
    context = null
  }
  return context
}

export const canvasMeasure = (): MeasureText => {
  const ctx = canvasContext()
  if (!ctx) return countCharacters
  return (text, fontFamily) => {
    const font = `${MEASURE_SIZE}px ${fontFamily || 'sans-serif'}`
    if (font !== fontSet) {
      ctx.font = font
      fontSet = font
    }
    return ctx.measureText(text).width
  }
}
