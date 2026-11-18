export const REQUEST_ID_HEADER = 'x-request-id'

export const SHORT_REQUEST_ID_LENGTH = 8

export function shortRequestId(requestId: string): string {
  return requestId.slice(0, SHORT_REQUEST_ID_LENGTH)
}
