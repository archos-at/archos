import manifest from './art.json'

export type ArtId = keyof typeof manifest.art

export interface ArtFile {
  density: number
  src: string
  width: number
  height: number
}

export interface ArtEntry {
  width: number
  height: number
  files: readonly ArtFile[]
}

export function art(id: ArtId): ArtEntry {
  return manifest.art[id]
}

export function artImage(id: ArtId): {
  src: string
  srcSet: string
  width: number
  height: number
} {
  const a = art(id)
  const one = a.files.find((f) => f.density === 1) ?? a.files[0]
  return {
    src: one.src,
    srcSet: a.files.map((f) => `${f.src} ${f.width}w`).join(', '),
    width: a.width,
    height: a.height,
  }
}
