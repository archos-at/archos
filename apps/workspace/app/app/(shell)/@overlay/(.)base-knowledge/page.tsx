/**
 * Grundlagen des Büros, intercepted: a soft navigation to `/app/base-knowledge`
 * renders the sheet above the page the reader was on, as the Büroablage's does.
 */
import type { JSX } from 'react'
import { BaseKnowledgeSheet } from '../../base-knowledge/base-knowledge-sheet'

export default function BaseKnowledgeOverlayPage(): JSX.Element {
  return <BaseKnowledgeSheet standalone={false} />
}
