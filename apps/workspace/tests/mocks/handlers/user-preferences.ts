import { http, HttpResponse } from 'msw'

export const userPreferencesHandlers = [
  http.get('/api/user/preferences', () => HttpResponse.json({ prefs: {} })),
  http.post('/api/user/preferences', () => HttpResponse.json({ ok: true })),
]
