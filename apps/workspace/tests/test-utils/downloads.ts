import { vi } from 'vitest'

export interface StartedDownload {
  href: string
  download: string
}

export function captureDownloads(): StartedDownload[] {
  const started: StartedDownload[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    started.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
  return started
}
