// Coordinates place a person: shown to people with access to the document, never sent to a model.
export interface PhotoCapture {
  capturedAt?: string
  latitude?: number
  longitude?: number
  camera?: string
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

export function parsePhotoCapture(raw: unknown): PhotoCapture | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>

  const capture: PhotoCapture = {}
  if (nonEmptyString(fields.captured_at)) capture.capturedAt = fields.captured_at
  if (isCoordinate(fields.latitude, 90) && isCoordinate(fields.longitude, 180)) {
    capture.latitude = fields.latitude
    capture.longitude = fields.longitude
  }
  if (nonEmptyString(fields.camera)) capture.camera = fields.camera

  return Object.keys(capture).length > 0 ? capture : null
}
