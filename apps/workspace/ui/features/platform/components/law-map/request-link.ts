/** A change request's id as the routes take it: a UUID, so nothing else reaches a request path. */
export const isRequestId = (id: string | null | undefined): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

/** Where a country's law map is, and a request on it: where every change request is read, confirmed and released. */
export const lawMapHref = (countryId: string, requestId?: string | null): string => `/app/platform/countries/${countryId.toLowerCase()}/map${requestId ? `?request=${encodeURIComponent(requestId)}` : ''}`
