import type { CSSProperties } from 'react'

export const AVATAR_HUES = [22, 56, 92, 138, 176, 214, 250, 288, 320, 352] as const

const IDENTITY_INK_LIGHTNESS = 0.52
const IDENTITY_INK_CHROMA = 0.16

const BASE_LIGHTNESS = 0.62
const BASE_CHROMA = 0.13

const TINT_STRENGTH = 16
const INK_STRENGTH = 55

function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function avatarPaletteIndex(userId: string): number {
  const key = userId.trim()
  if (!key) return 0
  return hash32(key) % AVATAR_HUES.length
}

export function avatarHue(userId: string): number {
  return AVATAR_HUES[avatarPaletteIndex(userId)]
}

export function avatarColorStyle(userId: string): CSSProperties {
  const base = `oklch(${BASE_LIGHTNESS} ${BASE_CHROMA} ${avatarHue(userId)})`
  return {
    backgroundColor: `color-mix(in oklch, ${base} ${TINT_STRENGTH}%, var(--card))`,
    color: `color-mix(in oklch, ${base} ${INK_STRENGTH}%, var(--foreground))`,
  }
}

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts
    .slice(0, 2)
    .map((part) => [...part][0]?.toLocaleUpperCase() ?? '')
    .join('')
  return letters || '?'
}

export function identityInk(userId: string): string {
  return `oklch(${IDENTITY_INK_LIGHTNESS} ${IDENTITY_INK_CHROMA} ${avatarHue(userId)})`
}
