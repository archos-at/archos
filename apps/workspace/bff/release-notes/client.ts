/**
 * The browser's half of the "Neu diese Woche" notice (ADR-0154, amendment): record that the
 * person has seen a week's summary. Fails soft, like the preferences client: a notice that could
 * not record itself shows once more on the next load, which beats a broken frame.
 */

'use client'

export async function postReleaseSummarySeen(week: string): Promise<boolean> {
  try {
    const res = await fetch('/api/release-notes/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week }),
    })
    return res.ok
  } catch {
    return false
  }
}
