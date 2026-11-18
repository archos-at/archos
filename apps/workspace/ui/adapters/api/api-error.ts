export class ApiRequestError extends Error {
  readonly status: number
  readonly reason: string | null
  readonly details: Readonly<Record<string, unknown>> | null

  constructor(message: string, status: number, reason: string | null = null, details: Readonly<Record<string, unknown>> | null = null) {
    super(message)
    this.status = status
    this.reason = reason
    this.details = details
  }
}
