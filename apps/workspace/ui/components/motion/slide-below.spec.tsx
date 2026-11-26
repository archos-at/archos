import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test-utils'
import { useSlideBelow } from './slide-below'

const layout = new Map<string, { top: number; height: number }>()
let listHeight = 0
let reduced = false
const played: Array<{ id: string; keyframes: Keyframe[] }> = []

const List = ({ ids }: { ids: string[] }) => {
  const listRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)
  useSlideBelow(listRef, clipRef)
  return (
    <div ref={clipRef} data-id="panel">
      <div ref={listRef} data-id="list">
        {ids.map((id) => (
          <div key={id} data-id={id} />
        ))}
      </div>
    </div>
  )
}

const keyframesOf = (id: string) => played.filter((p) => p.id === id).map((p) => p.keyframes)

beforeEach(() => {
  layout.clear()
  played.length = 0
  reduced = false
  const box = (element: HTMLElement) => layout.get(element.dataset.id ?? '')
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return box(this)?.top ?? 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.id === 'list' ? listHeight : (box(this)?.height ?? 0)
  })
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null) {
    played.push({ id: (this as HTMLElement).dataset.id ?? '', keyframes: keyframes as Keyframe[] })
    return { cancel: () => {} } as Animation
  }
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduced && query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  )
})

afterEach(() => vi.restoreAllMocks())

const grow = () => {
  layout.set('graph', { top: 0, height: 300 })
  layout.set('steps', { top: 300, height: 60 })
  listHeight = 360
  const view = render(<List ids={['graph', 'steps']} />)
  layout.set('graph', { top: 0, height: 500 })
  layout.set('steps', { top: 500, height: 60 })
  listHeight = 560
  view.rerender(<List ids={['graph', 'steps']} />)
}

describe('a list that grows above what stands below it', () => {
  it('slides the block below from where it stood, reveals what grew, and the edge of the frame with it', () => {
    grow()
    expect(keyframesOf('steps')).toEqual([[{ translate: '0 -200px' }, { translate: '0 0' }]])
    expect(keyframesOf('graph')).toEqual([
      [{ clipPath: 'inset(-8px -8px 200px -8px)' }, { clipPath: 'inset(-8px -8px 0px -8px)' }],
    ])
    expect(keyframesOf('panel')).toEqual([
      [{ clipPath: 'inset(-8px -8px 200px -8px)' }, { clipPath: 'inset(-8px -8px 0px -8px)' }],
    ])
  })

  it('under reduced motion fades the block out where it stood and in where it lands, moving nothing visibly', () => {
    reduced = true
    grow()
    const [frames] = keyframesOf('steps')
    expect(frames).toEqual([
      { translate: '0 -200px', opacity: 1, offset: 0 },
      { translate: '0 -200px', opacity: 0, offset: 0.5 },
      { translate: '0 0', opacity: 0, offset: 0.5 },
      { translate: '0 0', opacity: 1, offset: 1 },
    ])
  })

  it('plays nothing on its first layout, so a list that opens already written simply stands', () => {
    layout.set('graph', { top: 0, height: 300 })
    listHeight = 300
    render(<List ids={['graph']} />)
    expect(played).toEqual([])
  })
})
