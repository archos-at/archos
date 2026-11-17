import { normalizeProfilePatchOperation } from './legacy-names'
import {
  ProjectPrimitiveValueSchema,
  ProjectProfilePatchOperationSchema,
  ProjectProfileSchema,
  safePatchPath,
} from './types'
import type { ProjectProfile, ProjectProfilePatchOperation } from './types'

const UNSAFE_POINTER_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function emptyProjectProfile(): ProjectProfile {
  return ProjectProfileSchema.parse({})
}

export function applyProjectProfilePatch(
  profile: ProjectProfile,
  patch: ProjectProfilePatchOperation[]
): ProjectProfile {
  const next = structuredClone(ProjectProfileSchema.parse(profile))

  for (const legacyOperation of patch) {
    const operation = normalizeProfilePatchOperation(legacyOperation)
    assertSafePath(operation.path)
    const parsedOperation = ProjectProfilePatchOperationSchema.parse(operation)
    applyPatchOperation(next, parsedOperation)
  }

  return ProjectProfileSchema.parse(next)
}

function applyPatchOperation(
  profile: ProjectProfile,
  operation: ProjectProfilePatchOperation
): void {
  const parts = operation.path.split('/').slice(1).map(decodeJsonPointerSegment)
  parts.forEach((part) => assertSafePointerSegment(part, operation.path))
  const key = parts.at(-1)
  if (!key) {
    throw new Error(`Unsafe project profile patch path: ${operation.path}`)
  }

  const parent = parts.slice(0, -1).reduce<unknown>((target, part) => {
    if (!isObjectLike(target)) {
      throw new Error(`Unsafe project profile patch path: ${operation.path}`)
    }

    if (Array.isArray(target)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= target.length) {
        throw new Error(`Unsafe project profile patch path: ${operation.path}`)
      }
      return target[index]
    }

    if (!Object.prototype.hasOwnProperty.call(target, part)) {
      throw new Error(`Unsafe project profile patch path: ${operation.path}`)
    }

    return target[part]
  }, profile)

  if (!isObjectLike(parent)) {
    throw new Error(`Unsafe project profile patch path: ${operation.path}`)
  }

  if (Array.isArray(parent)) {
    applyArrayOperation(parent, key, operation)
    return
  }

  if (operation.op === 'remove') {
    delete parent[key]
    return
  }

  parent[key] = operation.value
}

function applyArrayOperation(
  parent: unknown[],
  key: string,
  operation: ProjectProfilePatchOperation
): void {
  if (operation.op === 'add' && key === '-') {
    parent.push(operation.value)
    return
  }

  const index = Number(key)
  if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
    throw new Error(`Unsafe project profile patch path: ${operation.path}`)
  }

  if (operation.op === 'remove') {
    parent.splice(index, 1)
    return
  }

  parent[index] = operation.value
}

export function isPatchAlreadyApplied(
  profile: ProjectProfile,
  patch: ProjectProfilePatchOperation[]
): boolean {
  const settle = (value: ProjectProfile) => pruneResolvedAssumptions(pruneResolvedUnknowns(value))
  return equalIgnoringInstants(
    settle(applyProjectProfilePatch(profile, patch)),
    settle(applyProjectProfilePatch(profile, []))
  )
}

const PROVENANCE_INSTANTS: ReadonlySet<string> = new Set(['updatedAt', 'at', 'recordedAt'])

function equalIgnoringInstants(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => equalIgnoringInstants(item, b[index]))
    )
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysOf = (value: Record<string, unknown>) =>
      Object.keys(value)
        .filter((key) => !PROVENANCE_INSTANTS.has(key))
        .sort()
    const keys = keysOf(a)
    const otherKeys = keysOf(b)
    return (
      keys.length === otherKeys.length &&
      keys.every((key, index) => key === otherKeys[index]) &&
      keys.every((key) => equalIgnoringInstants(a[key], b[key]))
    )
  }
  return a === b
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeProfilePatchOperations(
  patch: ProjectProfilePatchOperation[],
  now: string = new Date().toISOString()
): ProjectProfilePatchOperation[] {
  return patch.map((operation) => {
    if (operation.op === 'remove') return operation

    const factKey = matchTopLevelKey(operation.path, 'facts')
    if (factKey && isBareValue(operation.value)) {
      return {
        ...operation,
        value: {
          value: operation.value,
          confidence: 'confirmed',
          source: 'user_confirmed',
          updatedAt: now,
        },
      }
    }

    const assumptionKey = matchTopLevelKey(operation.path, 'assumptions')
    if (assumptionKey && isBareValue(operation.value)) {
      return {
        ...operation,
        value: {
          value: operation.value,
          status: 'unconfirmed',
          reason: '',
          source: 'agent_suggested',
          updatedAt: now,
        },
      }
    }

    return operation
  })
}

export function pruneResolvedUnknowns(profile: ProjectProfile): ProjectProfile {
  const unknowns = [...new Set(profile.unknowns)].filter((key) => !(key in profile.facts))
  if (unknowns.length === profile.unknowns.length) return profile
  return { ...profile, unknowns }
}

export function pruneResolvedAssumptions(profile: ProjectProfile): ProjectProfile {
  const stale = Object.keys(profile.assumptions).filter((key) => key in profile.facts)
  if (stale.length === 0) return profile
  const assumptions = { ...profile.assumptions }
  for (const key of stale) delete assumptions[key]
  return { ...profile, assumptions }
}

function matchTopLevelKey(path: string, section: 'facts' | 'assumptions'): string | null {
  const parts = path.split('/')
  if (parts.length !== 3 || parts[1] !== section || !parts[2] || parts[2] === '-') return null
  return decodeJsonPointerSegment(parts[2])
}

function isBareValue(value: unknown): boolean {
  return ProjectPrimitiveValueSchema.safeParse(value).success
}

function assertSafePath(path: string): void {
  if (!safePatchPath.test(path)) {
    throw new Error(`Unsafe project profile patch path: ${path}`)
  }
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function assertSafePointerSegment(segment: string, path: string): void {
  if (UNSAFE_POINTER_SEGMENTS.has(segment)) {
    throw new Error(`Unsafe project profile patch path: ${path}`)
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}
