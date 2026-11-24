/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { check, planFixes, readLadder, rewrite } from './check-concentric-radius.mjs'

const ladder = readLadder(
  `--radius-inline: 6px; --radius-control: var(--ds-radius-control); --radius-surface: var(--ds-radius-surface); --radius-overlay: 16px; --radius-lg: var(--ds-radius-surface);`,
  `--ds-radius-control: 6px;\n--ds-radius-surface: 10px;\n`
)
const findingsIn = (sources) => check({ sources, ladder }).findings
const fixed = (sources) => {
  const changed = rewrite(sources, planFixes(check({ sources, ladder })).edits)
  return { changed, left: findingsIn({ ...sources, ...changed }) }
}

describe('readLadder', () => {
  it('resolves the steps written as var(--ds-radius-…)', () => {
    expect(ladder).toMatchObject({ control: 6, surface: 10, overlay: 16, lg: 10 })
  })
})

describe('check', () => {
  it('wants a menu item 6px inside a radius-16 menu at 10 (the account menu, 2026-11-24)', () => {
    const [finding] = findingsIn({ 'ui/menu.tsx': `export const M = () => <div className="rounded-overlay p-1.5"><a className="rounded-control px-2">x</a></div>` })
    expect(finding).toMatchObject({ R: 16, r: 6, gap: [6, 6], expected: 10 })
  })

  it('counts the outer border into the gap', () => {
    const findings = findingsIn({ 'ui/x.tsx': `export const X = () => <div className="rounded-overlay border p-1"><a className="rounded-surface">x</a></div>` })
    expect(findings.map((f) => f.expected)).toEqual([11])
  })

  it('passes a concentric pair', () => {
    expect(findingsIn({ 'ui/x.tsx': `export const X = () => <div className="rounded-overlay p-1.5"><a className="rounded-surface">x</a></div>` })).toEqual([])
  })

  it('carries the padding of a wrapper without a radius down to the box inside it', () => {
    const [finding] = findingsIn({ 'ui/x.tsx': `export const X = () => <div className="rounded-overlay p-1"><ul className="p-0.5"><li className="rounded-control">x</li></ul></div>` })
    expect(finding).toMatchObject({ gap: [6, 6], expected: 10 })
  })

  it('resolves kit components across files, with the padding between the root and {children}', () => {
    const findings = findingsIn({
      'ui/kit.tsx': `
        export const Content = ({ children }) => <Portal><P.Root className={cn('rounded-overlay shadow-md')}><P.Viewport className="p-1.5">{children}</P.Viewport></P.Root></Portal>
        export const Item = (props) => <P.Item className={cn('flex rounded-control px-2', props.className)} {...props} />`,
      'ui/feature.tsx': `export const F = () => <Content><Item>a</Item><Item>b</Item></Content>`,
    })
    expect(findings.map((f) => [f.file, f.expected])).toEqual([['ui/feature.tsx', 10], ['ui/feature.tsx', 10]])
  })

  it('reads an imported cva variant function for its base classes, and a same-file helper for its JSX', () => {
    const findings = findingsIn({
      'ui/toggle.tsx': `const toggleVariants = cva('inline-flex rounded-control', { variants: { size: { sm: 'rounded-none' } } })\nexport { toggleVariants }`,
      'ui/group.tsx': `import { toggleVariants } from './toggle'\nexport const Item = (p) => <I className={cn(toggleVariants({ size: p.size }), p.className)} />`,
      'ui/switch.tsx': `export const S = () => { const item = (v) => <Item value={v} />; return <G className="rounded-control bg-desk p-0.5">{item('a')}</G> }`,
    })
    expect(findings.map((f) => [f.inner.name, f.expected])).toEqual([['Item', 4]])
  })

  it('takes a component box from what it returns, not from an element built before the return', () => {
    expect(findingsIn({
      'ui/shell.tsx': `export function Shell({ children }) { const action = <button className="rounded-overlay" />; return <section className="bg-card p-8">{children}{action}</section> }`,
      'ui/page.tsx': `export const P = () => <Shell><div className="rounded-surface border" /></Shell>`,
    })).toEqual([])
  })

  it('never nests a portalled or Radix Content layer in the element it is written in', () => {
    expect(findingsIn({
      'ui/kit.tsx': `export const Sub = (p) => <P.SubContent className="rounded-overlay p-1.5" {...p} />`,
      'ui/feature.tsx': `export const F = () => <div className="rounded-overlay p-1.5"><Sub /></div>`,
    })).toEqual([])
  })

  it('leaves text set in a box with uneven sides, a box deep in the curve and a centred box alone', () => {
    expect(findingsIn({
      'ui/x.tsx': `export const X = () => <>
        <div className="rounded-overlay px-4 py-2"><a className="rounded-control">uneven</a></div>
        <div className="rounded-surface p-2"><input className="rounded-control" /></div>
        <button className="rounded-control flex items-center justify-center size-8"><kbd className="rounded-inline">K</kbd></button>
      </>`,
    })).toEqual([])
  })

  it('reads a className through cn(), a + concatenation and a same-file const, never a condition', () => {
    const findings = findingsIn({
      'ui/x.tsx': `const TRACK = 'rounded-overlay p-1.5'
        export const X = ({ on }) => <div className={cn(TRACK + ' flex', on && 'rounded-none')}><a className={on ? 'rounded-none' : 'rounded-control'}>x</a><b className="rounded-control">y</b></div>`,
    })
    expect(findings.map((f) => f.inner.name)).toEqual(['b'])
  })
})

describe('--fix', () => {
  it('rewrites the inner class to the ladder step', () => {
    const { changed, left } = fixed({ 'ui/menu.tsx': `export const M = () => <div className="rounded-overlay bg-popover p-1.5"><a className="rounded-control px-2">x</a></div>` })
    expect(left).toEqual([])
    expect(changed['ui/menu.tsx']).toContain('<a className="rounded-surface px-2">')
  })

  it('fixes a kit pair in the kit, once, not at every use', () => {
    const { changed, left } = fixed({
      'ui/kit.tsx': `export const Menu = ({ children }) => <div className="rounded-overlay bg-popover p-1.5">{children}</div>
        export const Item = (p) => <div className={cn('rounded-control px-2', p.className)} {...p} />`,
      'ui/a.tsx': `export const A = () => <Menu><Item /></Menu>`,
      'ui/b.tsx': `export const B = () => <Menu><Item /><Item /></Menu>`,
    })
    expect(left).toEqual([])
    expect(Object.keys(changed)).toEqual(['ui/kit.tsx'])
    expect(changed['ui/kit.tsx']).toContain(`cn('rounded-surface px-2'`)
  })

  it('shapes an outer that paints nothing (a focus ring around a chip) to the box inside it', () => {
    const { changed } = fixed({ 'ui/x.tsx': `export const X = () => <button className="rounded-control focus-visible:ring-2"><span className="rounded-overlay bg-desk">chip</span></button>` })
    expect(changed['ui/x.tsx']).toContain('<button className="rounded-overlay focus-visible:ring-2">')
  })

  it('grows a track around its tabs instead of squaring them off at 2px', () => {
    const { changed, left } = fixed({
      'ui/tabs.tsx': `export const List = (p) => <L className={cn('rounded-control bg-desk p-1', p.className)} {...p} />
        export const Tab = (p) => <T className={cn('flex-1 rounded-control px-2', p.className)} {...p} />`,
      'ui/page.tsx': `export const P = () => <List><Tab /><Tab /></List>`,
    })
    expect(left).toEqual([])
    expect(changed['ui/tabs.tsx']).toContain(`cn('rounded-surface bg-desk p-1'`)
    expect(changed['ui/tabs.tsx']).toContain(`cn('flex-1 rounded-control px-2'`)
  })

  it('writes an exact value where no step fits, and reports the use a kit class cannot also satisfy', () => {
    const { changed, left } = fixed({
      'ui/kit.tsx': `export const Item = (p) => <div className={cn('rounded-control', p.className)} {...p} />`,
      'ui/a.tsx': `export const A = () => <div className="rounded-overlay bg-popover p-2"><Item /></div>`,
      'ui/b.tsx': `export const B = () => <div className="rounded-overlay bg-popover p-1"><Item /></div>`,
      'ui/c.tsx': `export const C = () => <div className="rounded-overlay bg-popover p-2"><i className="rounded-control" /></div>`,
    })
    expect(changed['ui/c.tsx']).toContain('<i className="rounded-[8px]" />')
    expect(left.map((f) => f.file)).toEqual(['ui/b.tsx'])
  })
})
