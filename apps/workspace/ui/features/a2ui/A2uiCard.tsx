'use client'

import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'

import type { AnswerCard } from '@/shared/cards/schemas'
import { CardPlaceholder } from '@/features/cards/components/CardPlaceholder'
import { CardRendererProvider, DrawnProvider, preflight, TextBlock, useDrawnReporter, type CardRenderer } from './catalog'
import { surfaceComponents, surfaceLeaves } from './surface-messages'

interface A2uiCardProps {
  card: AnswerCard
  surfaceKey: string
  render: CardRenderer
}

function Direct({ card, render }: Pick<A2uiCardProps, 'card' | 'render'>) {
  if (card.type !== 'surface') return <>{render(card, 'root')}</>
  return (
    <div className="flex flex-col gap-3">
      {surfaceLeaves(card).map(({ id, leaf }) => (
        <div key={id}>{'text' in leaf ? <TextBlock text={leaf.text} /> : render(leaf, id)}</div>
      ))}
    </div>
  )
}

type FallbackProps = { fallback: ReactNode; onFail: (() => void) | null; children: ReactNode }

class Fallback extends Component<FallbackProps, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[A2UI] surface render failed; drawing the card directly', error, info.componentStack)
    this.props.onFail?.()
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

type Renderer = typeof import('./react-catalog')

let rendererModule: Renderer | 'failed' | null = null
const rendererListeners = new Set<() => void>()
const rendererLoad: Promise<void> =
  typeof window === 'undefined'
    ? Promise.resolve()
    : import('./react-catalog')
        .then((loaded) => {
          rendererModule = loaded
        })
        .catch((error: unknown) => {
          console.warn('[A2UI] renderer failed to load; drawing cards directly', error)
          rendererModule = 'failed'
        })
        .finally(() => rendererListeners.forEach((listener) => listener()))
export const rendererSettled = (): Promise<void> => rendererLoad
const subscribeRenderer = (listener: () => void) => {
  rendererListeners.add(listener)
  return () => rendererListeners.delete(listener)
}
const useRenderer = () => useSyncExternalStore(subscribeRenderer, () => rendererModule, () => null)

export function A2uiCard({ card, surfaceKey, render }: A2uiCardProps) {
  const loaded = useRenderer()
  const renderer = loaded === 'failed' ? null : loaded
  const content = useMemo(() => JSON.stringify(card), [card])
  const surface = useMemo(() => {
    if (!renderer) return null
    const refusal = preflight(surfaceComponents(card), { surface: card.type === 'surface' })
    if (refusal) {
      console.warn('[A2UI] surface refused; drawing the card directly', card.type, refusal)
      return null
    }
    try {
      return renderer.buildSurface(card, surfaceKey)
    } catch (error) {
      console.warn('[A2UI] surface refused; drawing the card directly', card.type, error)
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `content` stands for `card`
  }, [renderer, content, surfaceKey])

  const [drawnSurface, setDrawnSurface] = useState<object | null>(null)
  const drawn = surface !== null && drawnSurface === surface
  const reportDrawn = useCallback(() => setDrawnSurface(surface), [surface])
  const refused = loaded !== null && surface === null
  const reportOnScreen = useDrawnReporter()
  const drawnNow = useRef(drawn)
  useLayoutEffect(() => {
    drawnNow.current = drawn
  }, [drawn])
  const [placeholderSeen, setPlaceholderSeen] = useState(false)
  useEffect(() => {
    if (!surface || drawn || placeholderSeen) return
    const frame = requestAnimationFrame(() => {
      if (!drawnNow.current) setPlaceholderSeen(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [surface, drawn, placeholderSeen])
  useLayoutEffect(() => {
    if (drawn || refused) reportOnScreen?.()
  }, [drawn, refused, reportOnScreen])

  const direct = <Direct card={card} render={render} />
  const body = (
    <div className="relative">
      {!surface && (refused ? direct : <CardPlaceholder />)}
      {surface && (
        <CardRendererProvider value={render}>
          <DrawnProvider value={reportDrawn}>
            {/* Keyed on the content: a surface that failed once is retried
                when it changes, rather than staying on the fallback for good. */}
            <Fallback key={`${surfaceKey}|${content}`} fallback={direct} onFail={reportOnScreen}>
              {!drawn && <CardPlaceholder />}
              <div
                data-a2ui-surface={surfaceKey}
                data-a2ui-root={card.type}
                aria-hidden={drawn ? undefined : true}
                className={
                  drawn
                    ? reportOnScreen || !placeholderSeen
                      ? undefined
                      : 'animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none'
                    : 'pointer-events-none invisible absolute inset-x-0 top-0'
                }
              >
                {renderer && <renderer.A2uiSurface surface={surface} />}
              </div>
            </Fallback>
          </DrawnProvider>
        </CardRendererProvider>
      )}
    </div>
  )
  const title = card.type === 'surface' ? card.title?.trim() : undefined
  if (!title) return body
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <p className="card-title text-foreground">{title}</p>
      {body}
    </section>
  )
}
