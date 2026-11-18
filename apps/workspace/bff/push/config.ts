import 'server-only'

export interface WebPushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

function base64UrlLength(value: string): number {
  if (!BASE64URL.test(value)) return -1
  return Buffer.from(value, 'base64url').length
}

export function webPushConfigProblem(env: Record<string, string | undefined>): string | null {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
  const subject = env.WEB_PUSH_SUBJECT?.trim()
  if (!publicKey && !privateKey && !subject) return null
  if (!publicKey || !privateKey || !subject) {
    return 'WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY and WEB_PUSH_SUBJECT must be set together'
  }
  if (base64UrlLength(publicKey) !== 65) return 'WEB_PUSH_VAPID_PUBLIC_KEY is not a URL-safe base64 P-256 public key (65 bytes)'
  if (base64UrlLength(privateKey) !== 32) return 'WEB_PUSH_VAPID_PRIVATE_KEY is not a URL-safe base64 P-256 private key (32 bytes)'
  if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject)) {
    return 'WEB_PUSH_SUBJECT must be a mailto: address or an https: URL'
  }
  return null
}

let reported: string | null = null

export function webPushConfig(env: Record<string, string | undefined> = process.env): WebPushConfig | null {
  const problem = webPushConfigProblem(env)
  if (problem) {
    if (reported !== problem) {
      reported = problem
      console.warn(`[push] Web Push is off: ${problem}`)
    }
    return null
  }
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
  const subject = env.WEB_PUSH_SUBJECT?.trim()
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}
