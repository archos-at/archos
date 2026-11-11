/**
 * The browser's half of the "Neu diese Woche" notice (ADR-0156, amendment): record that the
 * person has seen a week's summary, and their switch for the notice. Fails soft, like the preferences client: a notice that could
 * not record itself shows once more on the next load, which beats a broken frame.
 */

'use client'

/** Record `week` as seen; with `stop`, also turn the notice off for good ("Nicht mehr anzeigen"). */
export async function postReleaseSummarySeen(week: string, stop = false): Promise<boolean> {
  try {
    const res = await fetch('/api/release-notes/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stop ? { week, stop } : { week }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Turn the weekly notice on or off for the person; true when the server kept it. */
export async function putReleaseNoticePreference(enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/release-notes/notice-preference', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    return res.ok
  } catch {
    return false
  }
}
