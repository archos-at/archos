export interface LayoutObserverOptions {
  frameWidth?: number
  intersecting?: boolean | ((target: Element) => boolean)
}

const DEFAULT_FRAME_WIDTH = 1024

export const installLayoutObservers = ({
  frameWidth = DEFAULT_FRAME_WIDTH,
  intersecting = true,
}: LayoutObserverOptions = {}): (() => void) => {
  const originalResize = globalThis.ResizeObserver
  const originalIntersection = globalThis.IntersectionObserver

  class ImmediateResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
      this.callback(
        [{ contentRect: { width: frameWidth } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  class ImmediateIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [
          {
            isIntersecting:
              typeof intersecting === 'function' ? intersecting(target) : intersecting,
            target,
          } as unknown as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ImmediateResizeObserver as unknown as typeof globalThis.ResizeObserver
  globalThis.IntersectionObserver =
    ImmediateIntersectionObserver as unknown as typeof globalThis.IntersectionObserver

  return () => {
    globalThis.ResizeObserver = originalResize
    globalThis.IntersectionObserver = originalIntersection
  }
}
