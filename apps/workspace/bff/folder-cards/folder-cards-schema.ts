import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { FOLDER_CARD_WIRE_SCHEMAS } from './types'

export function folderCardsJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(FOLDER_CARD_WIRE_SCHEMAS, {
    title: 'Grid folder card wire contract',
    description:
      'Generated from apps/workspace/bff/folder-cards/types.ts. Do not edit by hand: ' +
      'folder-cards-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
