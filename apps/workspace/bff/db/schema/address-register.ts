import { char, date, doublePrecision, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Official address registers imported into the cell (migration 0209, ADR-0172).
 * Platform tables: every tenant reads them, only the platform role writes them.
 * A lookup reads the release whose `status` is `active` (one per register).
 */
export const ADDRESS_REGISTER_RELEASE_STATUSES = ['loading', 'active', 'retired'] as const
export type AddressRegisterReleaseStatus = (typeof ADDRESS_REGISTER_RELEASE_STATUSES)[number]

export const addressRegisterReleases = pgTable('address_register_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  register: text('register').notNull(),
  countryId: char('country_id', { length: 2 }).notNull(),
  referenceDate: date('reference_date').notNull(),
  attribution: text('attribution').notNull(),
  sourceUrl: text('source_url'),
  entryCount: integer('entry_count').notNull().default(0),
  status: text('status', { enum: ADDRESS_REGISTER_RELEASE_STATUSES }).notNull().default('loading'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
})

export const addressRegisterEntries = pgTable(
  'address_register_entries',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => addressRegisterReleases.id, { onDelete: 'cascade' }),
    addressId: text('address_id').notNull(),
    municipalityCode: text('municipality_code').notNull(),
    municipalityName: text('municipality_name').notNull(),
    localityName: text('locality_name'),
    postcode: text('postcode').notNull(),
    streetName: text('street_name').notNull(),
    houseNumber: text('house_number').notNull(),
    streetKey: text('street_key').notNull(),
    houseKey: text('house_key').notNull(),
    placeKeys: text('place_keys').array().notNull().default([]),
    easting: doublePrecision('easting'),
    northing: doublePrecision('northing'),
    crs: integer('crs'),
  },
  (table) => [primaryKey({ columns: [table.releaseId, table.addressId] })]
)

export type AddressRegisterEntryRow = typeof addressRegisterEntries.$inferSelect
