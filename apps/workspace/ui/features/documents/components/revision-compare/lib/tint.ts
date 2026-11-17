export type Rgb = readonly [number, number, number]

export const OLDER_INK: Rgb = [0, 140, 255]
export const NEWER_INK: Rgb = [255, 90, 0]

export const rgbCss = ([r, g, b]: Rgb): string => `rgb(${r} ${g} ${b})`

export function tintCanvas(canvas: HTMLCanvasElement, ink: Rgb): void {
  const context = canvas.getContext('2d')
  if (!context || canvas.width === 0 || canvas.height === 0) return
  context.save()
  context.globalCompositeOperation = 'lighten'
  context.fillStyle = rgbCss(ink)
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.restore()
}

export const multiplyInks = (a: Rgb, b: Rgb): Rgb => [
  Math.round((a[0] * b[0]) / 255),
  Math.round((a[1] * b[1]) / 255),
  Math.round((a[2] * b[2]) / 255),
]

export const UNCHANGED_INK: Rgb = multiplyInks(OLDER_INK, NEWER_INK)

export const PAPER: Rgb = [255, 255, 255]
export const PAPER_INK: Rgb = [31, 32, 35]
export const MARK_INK: Rgb = [150, 105, 14]

export function paperVariables(): Record<`--${string}`, string> {
  return {
    '--compare-paper': rgbCss(PAPER),
    '--compare-paper-ink': rgbCss(PAPER_INK),
    '--compare-mark': rgbCss(MARK_INK),
    '--compare-mark-fill': `rgb(${MARK_INK.join(' ')} / 8%)`,
    '--compare-mark-fill-active': `rgb(${MARK_INK.join(' ')} / 16%)`,
  }
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb): number => {
    const [r, g, bl] = rgb.map((channel) => {
      const c = channel / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
