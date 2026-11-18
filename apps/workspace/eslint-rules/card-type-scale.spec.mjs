/**
 * The guard on the guard. `grid/card-type-scale` is the only thing standing
 * between the card set and a fourteenth font size, and its two failure modes
 * are opposite and both silent: miss `text-[13px]` and the drift comes back,
 * flag `text-muted-foreground` and the next author disables the rule.
 */

import { RuleTester } from 'oxlint/plugins-dev'
import { describe, expect, it } from 'vitest'
import rule from './card-type-scale.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'jsx' } },
})

ruleTester.run('card-type-scale', rule, {
  valid: [
    `const a = 'card-eyebrow text-muted-foreground'`,
    `const a = 'card-meta font-mono text-muted-foreground/60'`,
    `const a = 'card-body text-pretty'`,
    `const a = 'card-title text-foreground'`,
    `const a = 'card-figure-30 tracking-tight text-balance'`,
    `const a = 'text-muted-foreground text-subtle text-error text-success'`,
    `const a = 'size-3.5 w-3 h-[3px] max-w-[46ch]'`,
  ],
  invalid: [
    {
      code: `const a = 'text-sm font-semibold'`,
      errors: [{ messageId: 'offRamp' }],
    },
    {
      code: `const a = 'text-[13.5px] leading-[1.55]'`,
      errors: [{ messageId: 'offRamp' }],
    },
    {
      code: `const a = 'text-xs'; const b = 'text-[12px]'`,
      errors: [{ messageId: 'offRamp' }, { messageId: 'offRamp' }],
    },
    {
      code: `const a = 'md:text-lg text-2xl!'`,
      errors: [{ messageId: 'offRamp' }, { messageId: 'offRamp' }],
    },
    {
      code: 'const a = `text-[0.8rem] ${x}`',
      errors: [{ messageId: 'offRamp' }],
    },
    {
      code: `const a = 'the text-sm step is gone'`,
      errors: [{ messageId: 'offRamp' }],
    },
  ],
})

describe('grid/card-type-scale', () => {
  it('names the step to reach for, so the message is a fix and not a scolding', () => {
    const collected = []
    const context = {
      report: (descriptor) => collected.push(descriptor.data),
    }
    const visitor = rule.create(context)
    for (const value of ['text-[13.5px]', 'text-sm', 'text-2xl', 'text-[10px]']) {
      visitor.Literal({ type: 'Literal', value })
    }

    expect(collected.map((d) => d.step)).toEqual([
      'card-body (16px) — or `card-title` for the title, `card-figure-16` for a figure in a list',
      'card-body (16px) — or `card-title` for the title, `card-figure-16` for a figure in a list',
      'card-figure-24 (24px)',
      'card-eyebrow (10.5px) — or `SectionLabel`, which is the eyebrow',
    ])
  })
})
