// The audit schemas of the Papierkorb of either shelf (ADR-0088, ADR-0195), spread into
// `AUDIT_SCHEMAS` (`./schemas.mjs`, whose header holds the rules every entry follows).

export const FOLDER_BIN_AUDIT_SCHEMAS = /** @type {const} */ ({
  'project.folder.binned': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number', purgeAfter: 'string' },
  },
  'project.folder.restored': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number', restoredTo: 'string' },
  },
  'project.folder.purged': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number' },
  },
  'office_shelf.folder.binned': {
    targets: [{ type: 'organization' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number', purgeAfter: 'string' },
  },
  'office_shelf.folder.restored': {
    targets: [{ type: 'organization' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number', restoredTo: 'string' },
  },
  'office_shelf.folder.purged': {
    targets: [{ type: 'organization' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number' },
  },
})
