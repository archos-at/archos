'use client'

/**
 * Slots in the file preview and its review for what another feature owns.
 *
 * The diagrams feature already imports this one (filing links into Files), so
 * this feature importing the sketch editor back would close a feature cycle
 * (`feature-cycle`, docs/contributing/module-seams.md). The direction is kept
 * by a context instead: the app shell provides the slots (`app/app/layout.tsx`),
 * the preview renders whatever is provided, and without a provider (a spec, a
 * surface outside the shell) it renders nothing of them.
 *
 * The first is the review's stage for a Skizze (ADR-0148): a Skizze opens in
 * the same review as every document, with its Excalidraw canvas where a PDF's
 * pages would be (`DocumentReviewMode`'s `stage`). The diagrams feature owns
 * the canvas, its save and its room sync; the review owns everything around it.
 *
 * The second is a page action in the review's page menu: „Skizze auf dieser
 * Seite beginnen“ (S6, slice 1 of `docs/roadmap/working-on-a-plan.md`). A page
 * has one canvas, its review, so the entry lives there and not beside it; the
 * action is given the page in view and hands back the Skizze it made, which
 * the review opens with its own review (`onCreated`).
 */

import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import type { DocumentReview } from './hooks/use-document-review'

/** What the review hands its stage, beside the document: where its controls go, and its say over closing. */
export interface ReviewStageSlots {
  /** A node in the review's header for the stage's own controls (a portal target); null until it is mounted. */
  headerSlot: HTMLElement | null
  /** What the review asks before it closes: false keeps it open, and the stage asks the person itself. */
  setCloseGuard: (guard: (() => boolean) | null) => void
  /** Closes the review past the guard: the stage's own „Verwerfen“. */
  close: () => void
  /** A phone: the review docks the open card at the bottom edge, so the stage draws none beside its mark. */
  cardsDocked: boolean
}

/** A stage: the review's content area for one document, where a PDF's pages would be. */
export interface ReviewStageProps extends ReviewStageSlots {
  documentId: string
  /** The preview's review: one instance, so the tab is in the document's room once. */
  review: DocumentReview
  canPickAssignee: boolean
  /** The document's bytes changed (a Fassung saved here): the preview reads them again. */
  onChanged: () => void
}

/** What a page action is given: the document, the page the review shows, and where its result goes. */
export interface ReviewPageActionProps {
  documentId: string
  page: number
  /** The action made a document (a Skizze on the page): the review opens it. */
  onCreated: (documentId: string) => void
  /** The action failed, in words the review shows in its toaster. */
  onFailed: (message: string) => void
}

const ReviewStageContext = createContext<ComponentType<ReviewStageProps> | null>(null)
const ReviewPageActionContext = createContext<ComponentType<ReviewPageActionProps> | null>(null)

export function PreviewSlotsProvider({
  stage = null,
  pageAction = null,
  children,
}: {
  stage?: ComponentType<ReviewStageProps> | null
  pageAction?: ComponentType<ReviewPageActionProps> | null
  children: ReactNode
}) {
  return (
    <ReviewStageContext.Provider value={stage}>
      <ReviewPageActionContext.Provider value={pageAction}>{children}</ReviewPageActionContext.Provider>
    </ReviewStageContext.Provider>
  )
}

/** The provided page action, a menu item of the review's page menu; null when nothing is provided. */
export const useReviewPageAction = (): ComponentType<ReviewPageActionProps> | null => useContext(ReviewPageActionContext)

/** The provided stage for a Skizze's review; null when nothing is provided. */
export const useSketchStage = (): ComponentType<ReviewStageProps> | null => useContext(ReviewStageContext)
