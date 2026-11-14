/**
 * Where the wordmark stands, in both chromes. Above a project it is the org
 * header's (`OrgHeader`); inside one, the rail's head (`SidebarBrand`). Going
 * from the project overview into a project swaps the one for the other, and the
 * wordmark jumped 6px left and 5px down doing it (ticket #38, topic 7): the
 * header centred it in a 56px band 24px from the edge, the rail set it 18px
 * from the top above a 28px row, 18px from the edge.
 *
 * Both now centre it in the same 56px row, 24px from the chrome's left edge
 * (from `md`, where the rail exists; the phone's project chrome carries no
 * wordmark). The 24px is also the rail's nav-icon column, so the mark stands on
 * the line the section icons below it start from.
 */

/** The row the wordmark is centred in: a 56px band, in both scopes. */
export const BRAND_ROW = 'flex min-h-14 items-center'

/** The org header row's left inset from `md`: 24px. */
export const BRAND_INSET_ORG = 'md:pl-6'

/**
 * The rail's brand row inset: 12px, inside the rail header's own `px-3`, so
 * 24px from the rail's edge. The right side keeps the fold control where it was.
 */
export const BRAND_INSET_RAIL = 'pl-3 pr-1.5'
