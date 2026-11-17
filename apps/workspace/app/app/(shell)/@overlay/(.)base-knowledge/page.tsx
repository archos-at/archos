import type { JSX } from 'react'
import { BaseKnowledgeSheet } from '../../base-knowledge/base-knowledge-sheet'

export default function BaseKnowledgeOverlayPage(): JSX.Element {
  return <BaseKnowledgeSheet standalone={false} />
}
