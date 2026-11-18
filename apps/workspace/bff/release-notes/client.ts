'use client'

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
