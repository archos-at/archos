import { http, HttpResponse } from 'msw'

export const inboxHandlers = [http.get('/api/inbox/unread-anchors', () => HttpResponse.json({ anchorIds: [] }))]
