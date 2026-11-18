export interface StackTransform {
  x: number
  y: number
  scale: number
}

const IDENTITY: StackTransform = { x: 0, y: 0, scale: 1 }

const NEGLIGIBLE_SHIFT = 0.5
const NEGLIGIBLE_SCALE = 1e-3

const SETTLE_FALLBACK_MS = 400

export const isNegligible = (transform: StackTransform): boolean =>
  Math.abs(transform.x) < NEGLIGIBLE_SHIFT &&
  Math.abs(transform.y) < NEGLIGIBLE_SHIFT &&
  Math.abs(transform.scale - 1) < NEGLIGIBLE_SCALE

export const transformCss = (transform: StackTransform): string =>
  `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`

export class ContentTransform {
  private node: HTMLElement | null = null
  private settling: { timer: number; done: () => void } | null = null
  private live = false
  private readonly listeners = new Set<() => void>()

  attach(node: HTMLElement | null): void {
    if (this.node === node) return
    this.finish()
    this.node = node
  }

  get active(): boolean {
    return this.live || this.settling !== null
  }

  onRest(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  preview(transform: StackTransform): void {
    const node = this.node
    if (!node) return
    this.finish()
    this.live = true
    node.style.transformOrigin = '0 0'
    node.style.willChange = 'transform'
    node.style.transition = 'none'
    node.style.transform = transformCss(transform)
  }

  clear(): void {
    const node = this.node
    this.finish()
    this.live = false
    if (!node) return
    node.style.transform = ''
    node.style.transition = ''
    node.style.willChange = ''
  }

  settle(from: StackTransform, options: { animate: boolean }): void {
    const node = this.node
    this.clear()
    if (!node || isNegligible(from) || !options.animate) {
      this.rest()
      return
    }
    node.style.transformOrigin = '0 0'
    node.style.willChange = 'transform'
    node.style.transition = 'none'
    node.style.transform = transformCss(from)
    void node.offsetWidth
    node.style.transition = 'transform var(--motion-base) var(--ease-entrance)'
    node.style.transform = transformCss(IDENTITY)
    const done = (): void => {
      node.removeEventListener('transitionend', onEnd)
      if (!this.settling) return
      window.clearTimeout(this.settling.timer)
      this.settling = null
      node.style.transition = ''
      node.style.transform = ''
      node.style.willChange = ''
      this.rest()
    }
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === node && event.propertyName === 'transform') done()
    }
    node.addEventListener('transitionend', onEnd)
    this.settling = { timer: window.setTimeout(done, SETTLE_FALLBACK_MS), done }
  }

  finish(): void {
    const settling = this.settling
    if (settling) settling.done()
  }

  release(): void {
    if (!this.live) return
    this.clear()
    this.rest()
  }

  private rest(): void {
    this.live = false
    for (const listener of this.listeners) listener()
  }
}
