/**
 * What the office layer asks of the platform's own base knowledge (ADR-0158),
 * behind one interface. Until the platform records land (S7: listings,
 * releases), the stub answers nothing, so no office sees a listing yet; S7
 * replaces `platformKnowledge` and nothing else changes here.
 *
 * The outcome it serves: a norm the platform lists without text reads, for an
 * office that holds no copy, as "gelistet, kein Text"; for an office that holds
 * one, as its own copy (the office's entry, not this).
 */

/** An edition the platform lists: designation and label, and whether the platform holds its text. */
export interface ListedEdition {
  designation: string
  title: string
  editionLabel: string
  hasText: boolean
}

export interface PlatformKnowledge {
  /** Editions the platform lists whose designation is none of `held`: what an office knows of but holds no copy of. */
  listedNotHeld(held: readonly string[]): Promise<ListedEdition[]>
  /** Whether a platform revision is released to tenants (release moves, design §4.4). */
  isReleased(revisionId: string): Promise<boolean>
}

/** The platform as it is before its records: lists nothing, releases nothing. */
export const STUB_PLATFORM_KNOWLEDGE: PlatformKnowledge = {
  listedNotHeld: async () => [],
  isReleased: async () => false,
}

let current: PlatformKnowledge = STUB_PLATFORM_KNOWLEDGE

/** The platform the office layer reads. */
export function platformKnowledge(): PlatformKnowledge {
  return current
}

/** Swap the platform: S7's implementation at boot, a fake in a spec. Returns the previous one. */
export function usePlatformKnowledge(next: PlatformKnowledge): PlatformKnowledge {
  const previous = current
  current = next
  return previous
}
