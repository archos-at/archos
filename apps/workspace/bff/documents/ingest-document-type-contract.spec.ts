import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const read = (...path: string[]): string => readFileSync(join(REPO_ROOT, ...path), 'utf8')

const SERVICE = read('apps', 'workspace', 'bff', 'documents', 'ingest-dispatch.ts')
const REQUESTS = read('apps', 'agent-host', 'src', 'agent_host', 'models', 'requests.py')
const ROUTE = read('apps', 'agent-host', 'src', 'agent_host', 'routes', 'ingest.py')
const ADAPTER = read('packages', 'knowledge-layer', 'src', 'ingest', 'chosen_document_type.py')
const FIELD = read('apps', 'agent-host', 'src', 'agent_host', 'models', 'document_type_tag.py')
const VOCABULARY = read('packages', 'agent', 'src', 'agent', 'knowledge', 'document_classification.py')

const sentKey = (): string => {
  const sent = /\{\s*(\w+):\s*extras\.documentType\s*\}/.exec(SERVICE)
  expect(sent, 'dispatchIngest no longer sends extras.documentType').not.toBeNull()
  return sent![1]!
}

const ingestRequest = (): string => {
  const body = /^class IngestRequest\([A-Za-z, ]+\):\n([\s\S]*?)(?=^\S)/m.exec(REQUESTS)
  expect(body, 'class IngestRequest not found in requests.py').not.toBeNull()
  return body![1]!
}

const tupleValues = (body: string): string[] =>
  body
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim().replace(/,$/, ''))
    .filter((element) => element !== '')
    .map((element) => {
      const literal = /^"([^"]+)"$/.exec(element)
      if (literal) return literal[1]!
      const constant = /^[A-Z][A-Z0-9_]*$/.test(element)
        ? new RegExp(`^${element}(?::\\s*str)?\\s*=\\s*"([^"]+)"`, 'm').exec(VOCABULARY)
        : null
      expect(constant, `${element} in DOCUMENT_TYPE_TAGS is neither a string nor a string constant`).not.toBeNull()
      return constant![1]!
    })

describe('ingest document type contract', () => {
  it('sends the key IngestRequest declares', () => {
    expect(ingestRequest()).toMatch(new RegExp(`^\\s{4}${sentKey()}: DocumentTypeField = None$`, 'm'))
  })

  it('has the backend refuse a type outside the vocabulary the BFF types the field with', () => {
    expect(FIELD).toMatch(/def _known_document_type[\s\S]*?DOCUMENT_TYPE_TAGS[\s\S]*?raise ValueError/)
    expect(FIELD).toMatch(/DocumentTypeTag = Annotated\[str, AfterValidator\(_known_document_type\)\]/)

    const tuple = /^DOCUMENT_TYPE_TAGS: tuple\[str, \.\.\.\] = \(([\s\S]*?)^\)/m.exec(VOCABULARY)
    expect(tuple, 'DOCUMENT_TYPE_TAGS not found in document_classification.py').not.toBeNull()
    expect([...DOCUMENT_TYPE_TAGS]).toEqual(tupleValues(tuple![1]!))
  })

  it('carries the key from the request into the job config the ingest job reads', () => {
    const key = sentKey()
    expect(ROUTE).toContain(`"${key}": request.${key}`)
    expect(ADAPTER).toContain(`config.get("${key}")`)
  })
})
