import { MessageSquarePlus, MousePointer2, Ruler, Sparkles, Speech, SquareDashed, type LucideIcon } from 'lucide-react'
import { CALIBRATE_KEY } from './calibration-panel'
import type { ReviewTool } from '../../hooks/use-document-review'

/** A tool on the palette: the review's own, or the cursor chat, which sets nothing. */
export type PaletteTool = ReviewTool | 'chat'

/** The review's tools in palette order, each with its key and glyph. The tape's three follow them (`measure/measure-tools.tsx`). */
export const TOOLS: Array<{ tool: PaletteTool; key: string; icon: LucideIcon }> = [
  { tool: 'select', key: 'V', icon: MousePointer2 },
  { tool: 'point', key: 'C', icon: MessageSquarePlus },
  { tool: 'region', key: 'R', icon: SquareDashed },
  { tool: 'ask', key: 'P', icon: Sparkles },
  { tool: 'calibrate', key: CALIBRATE_KEY, icon: Ruler },
  // A head speaking, not a bubble: the comment tool already is one, and this one keeps nothing.
  { tool: 'chat', key: '/', icon: Speech },
]
