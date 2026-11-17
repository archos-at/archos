import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getWorkOS } from '@/lib/workos/client'

export type SecretBackend = 'workos-vault' | 'local-aes-gcm'

export interface StoredSecretRef {
  secretBackend: SecretBackend
  vaultObjectId: string | null
  encryptedKey: string | null
}

export interface SecretRowLike {
  id: string
  organizationId: string
  secretBackend: string
  vaultObjectId: string | null
  encryptedKey: string | null
}

export function activeSecretBackend(): SecretBackend {
  const configured = (process.env.BYOK_SECRET_BACKEND ?? '').toLowerCase()
  if (configured === 'vault' || configured === 'workos-vault') return 'workos-vault'
  if (configured === 'local' || configured === 'local-aes-gcm') return 'local-aes-gcm'
  return process.env.WORKOS_API_KEY ? 'workos-vault' : 'local-aes-gcm'
}

export function keyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 16)
}

export function keyHint(apiKey: string): string {
  return `…${apiKey.slice(-4)}`
}

interface LocalEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  iv: string
  ct: string
  tag: string
}

function localKek(): Buffer {
  const raw = process.env.BYOK_LOCAL_KEK
  if (!raw) {
    throw new Error(
      'BYOK_LOCAL_KEK is not set — required for the local-aes-gcm BYOK secret backend (32 bytes, base64)',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('BYOK_LOCAL_KEK must decode to exactly 32 bytes (AES-256)')
  }
  return key
}

function aad(organizationId: string, credentialId: string): Buffer {
  return Buffer.from(`${organizationId}:${credentialId}`, 'utf8')
}

export function encryptLocal(organizationId: string, credentialId: string, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', localKek(), iv)
  cipher.setAAD(aad(organizationId, credentialId))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const envelope: LocalEnvelope = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
  return JSON.stringify(envelope)
}

export function decryptLocal(organizationId: string, credentialId: string, envelopeJson: string): string {
  const envelope = JSON.parse(envelopeJson) as LocalEnvelope
  if (envelope.v !== 1 || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported local secret envelope')
  }
  const decipher = createDecipheriv('aes-256-gcm', localKek(), Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(aad(organizationId, credentialId))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()]).toString('utf8')
}

function vaultObjectName(organizationId: string, credentialId: string): string {
  return `grid-llm-credential-${organizationId}-${credentialId}`
}

export async function storeSecret(
  organizationId: string,
  credentialId: string,
  apiKey: string,
): Promise<StoredSecretRef> {
  const backend = activeSecretBackend()
  if (backend === 'workos-vault') {
    const object = await getWorkOS().vault.createObject({
      name: vaultObjectName(organizationId, credentialId),
      value: apiKey,
      context: { organizationId },
    })
    return { secretBackend: 'workos-vault', vaultObjectId: object.id, encryptedKey: null }
  }
  return {
    secretBackend: 'local-aes-gcm',
    vaultObjectId: null,
    encryptedKey: encryptLocal(organizationId, credentialId, apiKey),
  }
}

export async function revealSecret(row: SecretRowLike): Promise<string> {
  if (row.secretBackend === 'workos-vault') {
    if (!row.vaultObjectId) throw new Error('Credential row has no Vault object id')
    const object = await getWorkOS().vault.readObject({ id: row.vaultObjectId })
    const value = (object as { value?: unknown }).value
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('Vault object has no readable value')
    }
    return value
  }
  if (row.secretBackend !== 'local-aes-gcm') {
    throw new Error(`Unknown secret backend "${row.secretBackend}"`)
  }
  if (!row.encryptedKey) throw new Error('Credential row has no local ciphertext')
  return decryptLocal(row.organizationId, row.id, row.encryptedKey)
}

export async function deleteSecret(row: SecretRowLike): Promise<void> {
  try {
    if (row.secretBackend === 'workos-vault' && row.vaultObjectId) {
      await getWorkOS().vault.deleteObject({ id: row.vaultObjectId })
    }
  } catch (error) {
    console.warn(`[LLM Credentials] Vault secret deletion failed for credential ${row.id}:`, error)
  }
}
