/**
 * Class strings shared by the Contacts and Templates toolbars, so both pages
 * keep one button language: uppercase labels, navy ghost buttons, one solid
 * primary action on the right.
 */

export const toolbarCard = 'rounded-lg border bg-surface p-2.5'

const base =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold tracking-wide uppercase transition-colors disabled:pointer-events-none disabled:opacity-40'

/** Text-only action in the toolbar: Refresh, Filter, Sync. */
export const ghostButton = `${base} text-accent hover:bg-muted`

/** Secondary solid action: Import. */
export const secondaryButton = `${base} border border-accent text-accent hover:bg-accent-bg`

/** The page's main action: Add contact, Create template. */
export const primaryButton = `${base} bg-fg text-on-fg hover:opacity-90`

export const input =
  'h-9 w-full rounded-md border bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent disabled:bg-muted'

export const label = 'mb-1 block text-xs text-fg'

export const hint = 'mt-1 block text-[11px] text-fg-muted'

/** Plain buttons inside dialogs. */
export const dialogPrimary = 'h-9 rounded-md bg-fg px-4 text-sm text-on-fg hover:opacity-90 disabled:opacity-50'
export const dialogSecondary = 'h-9 rounded-md border bg-surface px-4 text-sm text-fg hover:bg-muted disabled:opacity-50'
export const dialogDanger = 'h-9 rounded-md bg-danger px-4 text-sm text-on-accent hover:opacity-90 disabled:opacity-50'
