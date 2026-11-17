import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge only knows Tailwind's stock radius names, so the semantic radii
// in tokens.css (`rounded-control`, `rounded-surface`, …) would never override a
// `rounded-*` default or a caller's `rounded-none`. Teach it the brand's ladder.
// The same for the type scale (`text-meta`, `text-name`, `text-section`, …): a size it does not know it reads as a
// colour, so `cn('text-name text-foreground')` kept the colour and silently dropped the size (paper on a desk, the
// tile's name rendered 16px). `utils.spec.ts` holds every `--text-*` size of the tokens to this list.
export const TYPE_SCALE = ['meta', 'name', 'section', 'pane-title', 'page-title', 'answer'] as const
export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [{ rounded: ['inline', 'control', 'surface', 'overlay', 'bubble'] }],
      'font-size': [{ text: [...TYPE_SCALE] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
